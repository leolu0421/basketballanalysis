/**
 * Benchmark evaluation: scores one video-analysis job's raw AI output
 * (VideoAnalysisCandidate rows, restricted to that single job — see
 * src/lib/actions/benchmark-eval-actions.ts, which is responsible for never
 * mixing candidates from a different job into this) against a benchmark
 * match's manually-verified ground truth (StatEvent rows with
 * source = "MANUAL" — see schema.prisma's comment on StatEvent.source for
 * why AI_CONFIRMED/UNKNOWN rows are never eligible).
 *
 * Deliberately a pure, DB-free module — same reasoning as candidates.ts and
 * localization.ts: the matching/metrics logic is the part that actually
 * needs to be trustworthy, so it's unit-testable on plain data without
 * ffmpeg, Prisma, or the network anywhere near it. This module never writes
 * to the database, never touches model weights, and pipeline.ts never
 * imports it — it only ever runs when a coach explicitly triggers an
 * evaluation from the /eval page, strictly after a job has already
 * completed.
 */

/**
 * How close (in video seconds) an AI event's timestamp has to be to a
 * ground-truth event's timestamp to be considered the same play. A single
 * named constant, never inlined elsewhere. Lives here rather than in
 * benchmark-eval-actions.ts because a "use server" file may only export
 * async functions — a plain constant export from one breaks the whole
 * module at the server/client boundary.
 */
export const DEFAULT_MATCH_TOLERANCE_SECONDS = 5;

export type GroundTruthEvent = {
  id: string;
  playerId: string;
  type: string;
  quarter: number;
  videoTimestampSeconds: number;
};

export type AiEvent = {
  id: string;
  guessedPlayerId: string | null;
  guessedStatType: string | null;
  videoTimestampSeconds: number;
  guessedJerseyNumber: string | null;
  localizationMethod: string | null;
};

export type MatchedPair = {
  groundTruth: GroundTruthEvent;
  aiEvent: AiEvent;
  deltaSeconds: number;
};

export type StrictMatchResult = {
  matchedPairs: MatchedPair[];
  falsePositives: AiEvent[];
  falseNegatives: GroundTruthEvent[];
};

/**
 * Matches AI events to ground truth requiring, as a precondition for a pair
 * to even be considered: same guessed player, same guessed stat type, and
 * |Δtimestamp| ≤ toleranceSeconds. Among all qualifying pairs, greedily
 * confirms the closest-timestamp one first, each side used at most once —
 * one-to-one, closest-first, per spec. Quarter is deliberately NOT a
 * matching precondition here: VideoAnalysisCandidate carries no quarter of
 * its own (only a continuous video timestamp), and at this tolerance two
 * events in different quarters can't plausibly collide anyway. Quarter is
 * used only for the per-quarter breakdown below, keyed off the ground
 * truth's own quarter.
 */
export function matchStrict(
  aiEvents: AiEvent[],
  groundTruth: GroundTruthEvent[],
  toleranceSeconds: number
): StrictMatchResult {
  const candidatePairs: { ai: number; gt: number; delta: number }[] = [];
  for (let ai = 0; ai < aiEvents.length; ai++) {
    const a = aiEvents[ai];
    if (a.guessedPlayerId === null || a.guessedStatType === null) continue;
    for (let gt = 0; gt < groundTruth.length; gt++) {
      const g = groundTruth[gt];
      if (a.guessedPlayerId !== g.playerId || a.guessedStatType !== g.type) continue;
      const delta = Math.abs(a.videoTimestampSeconds - g.videoTimestampSeconds);
      if (delta <= toleranceSeconds) candidatePairs.push({ ai, gt, delta });
    }
  }
  candidatePairs.sort((a, b) => a.delta - b.delta);

  const usedAi = new Set<number>();
  const usedGt = new Set<number>();
  const matchedPairs: MatchedPair[] = [];

  for (const { ai, gt, delta } of candidatePairs) {
    if (usedAi.has(ai) || usedGt.has(gt)) continue;
    usedAi.add(ai);
    usedGt.add(gt);
    matchedPairs.push({ groundTruth: groundTruth[gt], aiEvent: aiEvents[ai], deltaSeconds: delta });
  }

  return {
    matchedPairs,
    falsePositives: aiEvents.filter((_, i) => !usedAi.has(i)),
    falseNegatives: groundTruth.filter((_, i) => !usedGt.has(i)),
  };
}

/**
 * Where a missed ground-truth event's explanation lives in the pipeline —
 * Score detected → Candidate created → Localization → Tracking → Jersey
 * recognition → Player identification → Final confirmed prediction. Checked
 * in this order against the single nearest not-already-matched AI event (if
 * any); the first stage that looks like the cause wins, so a candidate that
 * failed at, say, jersey recognition isn't also blamed for the final-guess
 * mismatch that necessarily follows from it.
 */
export type FalseNegativeStage =
  | "no_ai_event_nearby"
  | "outside_tolerance"
  | "localization_failed"
  | "jersey_recognition_failed"
  | "player_identification_failed"
  | "stat_type_unclassified"
  | "wrong_player"
  | "wrong_event_type"
  | "unexplained";

export type ClassifiedFalseNegative = {
  groundTruth: GroundTruthEvent;
  stage: FalseNegativeStage;
  nearestAiEvent: AiEvent | null;
  deltaSeconds: number | null;
};

/**
 * Diagnostic-only pass over the false negatives from matchStrict — never
 * changes TP/FP/FN counts, just explains them. Only considers AI events not
 * already spent on a different ground-truth event in the strict pass
 * (usedAiEventIds), since those are already accounted for.
 *
 * "score detected / candidate created" isn't split out as its own stage:
 * scoreboard-diff reads discarded by the two-read confirmation filter
 * (see candidates.ts) never become a VideoAnalysisCandidate row, so there's
 * no per-event record to distinguish "never detected" from "detected but
 * filtered" — both collapse into no_ai_event_nearby. Splitting that further
 * would require new persistence in pipeline.ts, which is out of scope here.
 */
export function classifyFalseNegatives(
  falseNegatives: GroundTruthEvent[],
  allAiEvents: AiEvent[],
  usedAiEventIds: ReadonlySet<string>,
  toleranceSeconds: number
): ClassifiedFalseNegative[] {
  const unused = allAiEvents.filter((a) => !usedAiEventIds.has(a.id));

  return falseNegatives.map((g): ClassifiedFalseNegative => {
    const withinTolerance = unused
      .map((a) => ({ a, delta: Math.abs(a.videoTimestampSeconds - g.videoTimestampSeconds) }))
      .filter(({ delta }) => delta <= toleranceSeconds)
      .sort((x, y) => x.delta - y.delta);

    if (withinTolerance.length > 0) {
      const { a: c, delta } = withinTolerance[0];
      let stage: FalseNegativeStage;
      if (c.localizationMethod !== "vision") stage = "localization_failed";
      else if (c.guessedJerseyNumber === null) stage = "jersey_recognition_failed";
      else if (c.guessedPlayerId === null) stage = "player_identification_failed";
      else if (c.guessedStatType === null) stage = "stat_type_unclassified";
      else if (c.guessedPlayerId !== g.playerId) stage = "wrong_player";
      else if (c.guessedStatType !== g.type) stage = "wrong_event_type";
      // Player, type, and timing (within tolerance) all correct would have
      // strict-matched already, so this event wouldn't be here as a false
      // negative — kept only as a defensive fallback, never expected to hit.
      else stage = "unexplained";
      return { groundTruth: g, stage, nearestAiEvent: c, deltaSeconds: delta };
    }

    // Nothing nearby at all -- widen the search (same player+type,
    // unlimited distance) to tell "right label, just mistimed" apart from
    // "the AI never produced anything resembling this event anywhere."
    const sameLabelAnywhere = unused
      .filter((a) => a.guessedPlayerId === g.playerId && a.guessedStatType === g.type)
      .map((a) => ({ a, delta: Math.abs(a.videoTimestampSeconds - g.videoTimestampSeconds) }))
      .sort((x, y) => x.delta - y.delta)[0];

    if (sameLabelAnywhere) {
      return {
        groundTruth: g,
        stage: "outside_tolerance",
        nearestAiEvent: sameLabelAnywhere.a,
        deltaSeconds: sameLabelAnywhere.delta,
      };
    }

    return { groundTruth: g, stage: "no_ai_event_nearby", nearestAiEvent: null, deltaSeconds: null };
  });
}

export type PrecisionRecallF1 = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
};

function prf1(truePositives: number, falsePositives: number, falseNegatives: number): PrecisionRecallF1 {
  const precision = truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives);
  const recall = truePositives + falseNegatives === 0 ? 0 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositives, falsePositives, falseNegatives, precision, recall, f1 };
}

export type QuarterRecall = {
  groundTruthEvents: number;
  truePositives: number;
  falseNegatives: number;
  recall: number;
};

export const FALSE_NEGATIVE_STAGES: FalseNegativeStage[] = [
  "no_ai_event_nearby",
  "outside_tolerance",
  "localization_failed",
  "jersey_recognition_failed",
  "player_identification_failed",
  "stat_type_unclassified",
  "wrong_player",
  "wrong_event_type",
  "unexplained",
];

export type BenchmarkMetrics = {
  groundTruthEventCount: number;
  aiEventCount: number;
  toleranceSeconds: number;
  overall: PrecisionRecallF1;
  perPlayer: Record<string, PrecisionRecallF1>;
  perStatType: Record<string, PrecisionRecallF1>;
  /**
   * Recall only, not precision/F1 — an AI event carries no quarter of its
   * own (see matchStrict's doc comment), so a false positive can't be
   * attributed to a quarter without inventing a proxy. Reporting a fake
   * precision here would be exactly the "vague accuracy" number to avoid.
   */
  perQuarter: Record<number, QuarterRecall>;
  falseNegativeStageCounts: Record<FalseNegativeStage, number>;
  classifiedFalseNegatives: ClassifiedFalseNegative[];
};

type Counts = { tp: number; fp: number; fn: number };
function bump(map: Record<string, Counts>, key: string, field: keyof Counts) {
  (map[key] ??= { tp: 0, fp: 0, fn: 0 })[field]++;
}

export function computeBenchmarkMetrics(
  aiEvents: AiEvent[],
  groundTruth: GroundTruthEvent[],
  toleranceSeconds: number
): BenchmarkMetrics {
  const { matchedPairs, falsePositives, falseNegatives } = matchStrict(aiEvents, groundTruth, toleranceSeconds);
  const overall = prf1(matchedPairs.length, falsePositives.length, falseNegatives.length);

  const usedAiEventIds = new Set(matchedPairs.map((p) => p.aiEvent.id));
  const classifiedFalseNegatives = classifyFalseNegatives(falseNegatives, aiEvents, usedAiEventIds, toleranceSeconds);

  const falseNegativeStageCounts = Object.fromEntries(FALSE_NEGATIVE_STAGES.map((s) => [s, 0])) as Record<
    FalseNegativeStage,
    number
  >;
  for (const c of classifiedFalseNegatives) falseNegativeStageCounts[c.stage]++;

  // Per-player / per-stat-type: TP scoped by the ground truth's own
  // player/type; FN likewise; FP scoped by whatever the AI event itself
  // wrongly guessed (an unattributed false positive with a null guess
  // doesn't count against any specific player/type).
  const perPlayerCounts: Record<string, Counts> = {};
  const perStatTypeCounts: Record<string, Counts> = {};
  for (const pair of matchedPairs) {
    bump(perPlayerCounts, pair.groundTruth.playerId, "tp");
    bump(perStatTypeCounts, pair.groundTruth.type, "tp");
  }
  for (const fp of falsePositives) {
    if (fp.guessedPlayerId) bump(perPlayerCounts, fp.guessedPlayerId, "fp");
    if (fp.guessedStatType) bump(perStatTypeCounts, fp.guessedStatType, "fp");
  }
  for (const g of falseNegatives) {
    bump(perPlayerCounts, g.playerId, "fn");
    bump(perStatTypeCounts, g.type, "fn");
  }
  const perPlayer: Record<string, PrecisionRecallF1> = {};
  for (const [key, c] of Object.entries(perPlayerCounts)) perPlayer[key] = prf1(c.tp, c.fp, c.fn);
  const perStatType: Record<string, PrecisionRecallF1> = {};
  for (const [key, c] of Object.entries(perStatTypeCounts)) perStatType[key] = prf1(c.tp, c.fp, c.fn);

  const perQuarterCounts: Record<number, { tp: number; fn: number }> = {};
  for (const pair of matchedPairs) {
    (perQuarterCounts[pair.groundTruth.quarter] ??= { tp: 0, fn: 0 }).tp++;
  }
  for (const g of falseNegatives) {
    (perQuarterCounts[g.quarter] ??= { tp: 0, fn: 0 }).fn++;
  }
  const perQuarter: Record<number, QuarterRecall> = {};
  for (const [key, c] of Object.entries(perQuarterCounts)) {
    const groundTruthEvents = c.tp + c.fn;
    perQuarter[Number(key)] = {
      groundTruthEvents,
      truePositives: c.tp,
      falseNegatives: c.fn,
      recall: groundTruthEvents === 0 ? 0 : c.tp / groundTruthEvents,
    };
  }

  return {
    groundTruthEventCount: groundTruth.length,
    aiEventCount: aiEvents.length,
    toleranceSeconds,
    overall,
    perPlayer,
    perStatType,
    perQuarter,
    falseNegativeStageCounts,
    classifiedFalseNegatives,
  };
}
