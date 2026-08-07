import { describe, expect, it } from "vitest";
import {
  matchStrict,
  classifyFalseNegatives,
  computeBenchmarkMetrics,
  type AiEvent,
  type GroundTruthEvent,
} from "./benchmark-eval";

function gt(id: string, playerId: string, type: string, t: number, quarter = 1): GroundTruthEvent {
  return { id, playerId, type, quarter, videoTimestampSeconds: t };
}

function ai(
  id: string,
  playerId: string | null,
  type: string | null,
  t: number,
  extra?: Partial<Pick<AiEvent, "guessedJerseyNumber" | "localizationMethod">>
): AiEvent {
  return {
    id,
    guessedPlayerId: playerId,
    guessedStatType: type,
    videoTimestampSeconds: t,
    guessedJerseyNumber: extra?.guessedJerseyNumber ?? (playerId ? "5" : null),
    localizationMethod: extra?.localizationMethod ?? "vision",
  };
}

describe("matchStrict", () => {
  it("matches only when player, type, and timing all agree within tolerance", () => {
    const result = matchStrict([ai("a1", "p1", "FG2_MADE", 101)], [gt("g1", "p1", "FG2_MADE", 100)], 5);
    expect(result.matchedPairs).toHaveLength(1);
    expect(result.matchedPairs[0].deltaSeconds).toBe(1);
    expect(result.falsePositives).toHaveLength(0);
    expect(result.falseNegatives).toHaveLength(0);
  });

  it("does not match on timing alone -- wrong player leaves both sides unmatched", () => {
    const result = matchStrict([ai("a1", "wrong", "FG2_MADE", 100)], [gt("g1", "p1", "FG2_MADE", 100)], 5);
    expect(result.matchedPairs).toHaveLength(0);
    expect(result.falsePositives.map((a) => a.id)).toEqual(["a1"]);
    expect(result.falseNegatives.map((g) => g.id)).toEqual(["g1"]);
  });

  it("does not match on timing alone -- wrong type leaves both sides unmatched", () => {
    const result = matchStrict([ai("a1", "p1", "FG3_MADE", 100)], [gt("g1", "p1", "FG2_MADE", 100)], 5);
    expect(result.matchedPairs).toHaveLength(0);
  });

  it("respects the tolerance boundary exactly (inclusive)", () => {
    const atBoundary = matchStrict([ai("a1", "p1", "FG2_MADE", 100)], [gt("g1", "p1", "FG2_MADE", 105)], 5);
    expect(atBoundary.matchedPairs).toHaveLength(1);
    const justOutside = matchStrict([ai("a1", "p1", "FG2_MADE", 100)], [gt("g1", "p1", "FG2_MADE", 105.01)], 5);
    expect(justOutside.matchedPairs).toHaveLength(0);
  });

  it("is one-to-one, closest-timestamp-first, when multiple candidates could match one ground-truth event", () => {
    const result = matchStrict(
      [ai("far", "p1", "FG2_MADE", 90), ai("near", "p1", "FG2_MADE", 101)],
      [gt("g1", "p1", "FG2_MADE", 100)],
      15
    );
    expect(result.matchedPairs).toHaveLength(1);
    expect(result.matchedPairs[0].aiEvent.id).toBe("near");
    expect(result.falsePositives.map((a) => a.id)).toEqual(["far"]);
  });

  it("is one-to-one when multiple ground-truth events could match one candidate", () => {
    const result = matchStrict(
      [ai("a1", "p1", "FG2_MADE", 100)],
      [gt("far", "p1", "FG2_MADE", 90), gt("near", "p1", "FG2_MADE", 101)],
      15
    );
    expect(result.matchedPairs).toHaveLength(1);
    expect(result.matchedPairs[0].groundTruth.id).toBe("near");
    expect(result.falseNegatives.map((g) => g.id)).toEqual(["far"]);
  });

  it("never matches an AI event with a null guess", () => {
    const result = matchStrict([ai("a1", null, null, 100)], [gt("g1", "p1", "FG2_MADE", 100)], 5);
    expect(result.matchedPairs).toHaveLength(0);
    expect(result.falsePositives).toHaveLength(1);
    expect(result.falseNegatives).toHaveLength(1);
  });
});

describe("classifyFalseNegatives", () => {
  it("classifies a candidate that only fell back (no vision localization) as localization_failed", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const a = ai("a1", "wrong-player", "FG3_MADE", 100, { localizationMethod: "fallback_no_evidence" });
    const result = classifyFalseNegatives([g], [a], new Set(), 5);
    expect(result[0].stage).toBe("localization_failed");
    expect(result[0].nearestAiEvent?.id).toBe("a1");
  });

  it("classifies a null jersey number as jersey_recognition_failed", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const a = ai("a1", null, "FG2_MADE", 100, { guessedJerseyNumber: null });
    const result = classifyFalseNegatives([g], [a], new Set(), 5);
    expect(result[0].stage).toBe("jersey_recognition_failed");
  });

  it("classifies a read jersey number that didn't resolve to a player as player_identification_failed", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const a = ai("a1", null, "FG2_MADE", 100, { guessedJerseyNumber: "99" });
    const result = classifyFalseNegatives([g], [a], new Set(), 5);
    expect(result[0].stage).toBe("player_identification_failed");
  });

  it("classifies a resolved player with no stat type as stat_type_unclassified", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const a = ai("a1", "p1", null, 100);
    const result = classifyFalseNegatives([g], [a], new Set(), 5);
    expect(result[0].stage).toBe("stat_type_unclassified");
  });

  it("classifies a fully-resolved but wrong player as wrong_player", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const a = ai("a1", "p2", "FG2_MADE", 100);
    const result = classifyFalseNegatives([g], [a], new Set(), 5);
    expect(result[0].stage).toBe("wrong_player");
  });

  it("classifies a fully-resolved but wrong type as wrong_event_type", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const a = ai("a1", "p1", "FG3_MADE", 100);
    const result = classifyFalseNegatives([g], [a], new Set(), 5);
    expect(result[0].stage).toBe("wrong_event_type");
  });

  it("classifies a same-player-same-type event just outside tolerance as outside_tolerance, reporting the real delta", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const a = ai("a1", "p1", "FG2_MADE", 130); // 30s away, well outside a 5s tolerance
    const result = classifyFalseNegatives([g], [a], new Set(), 5);
    expect(result[0].stage).toBe("outside_tolerance");
    expect(result[0].deltaSeconds).toBe(30);
  });

  it("classifies no resembling AI event anywhere as no_ai_event_nearby", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const result = classifyFalseNegatives([g], [], new Set(), 5);
    expect(result[0].stage).toBe("no_ai_event_nearby");
    expect(result[0].nearestAiEvent).toBeNull();
  });

  it("excludes AI events already spent on a different ground-truth match", () => {
    const g = gt("g1", "p1", "FG2_MADE", 100);
    const a = ai("a1", "p1", "FG2_MADE", 100);
    // a1 already used elsewhere -- should not be reused to explain g1.
    const result = classifyFalseNegatives([g], [a], new Set(["a1"]), 5);
    expect(result[0].stage).toBe("no_ai_event_nearby");
  });
});

describe("computeBenchmarkMetrics", () => {
  it("scores a perfect run as precision=recall=f1=1", () => {
    const metrics = computeBenchmarkMetrics(
      [ai("a1", "p1", "FG2_MADE", 100), ai("a2", "p2", "FG3_MADE", 200)],
      [gt("g1", "p1", "FG2_MADE", 101), gt("g2", "p2", "FG3_MADE", 199)],
      5
    );
    expect(metrics.overall).toMatchObject({ truePositives: 2, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1, f1: 1 });
  });

  it("never divides by zero for empty input", () => {
    const metrics = computeBenchmarkMetrics([], [], 5);
    expect(metrics.overall).toMatchObject({ precision: 0, recall: 0, f1: 0 });
    expect(Number.isNaN(metrics.overall.precision)).toBe(false);
  });

  it("breaks down precision/recall/F1 per player and per stat type independently", () => {
    const metrics = computeBenchmarkMetrics(
      [
        ai("a1", "p1", "FG2_MADE", 100), // TP for p1/FG2_MADE
        ai("a2", "p2", "FG2_MADE", 999), // hallucinated FP for p2/FG2_MADE
      ],
      [gt("g1", "p1", "FG2_MADE", 100), gt("g2", "p2", "FT_MADE", 400)], // g2 missed entirely -> FN for p2/FT_MADE
      5
    );
    expect(metrics.perPlayer["p1"]).toMatchObject({ truePositives: 1, falsePositives: 0, falseNegatives: 0 });
    expect(metrics.perPlayer["p2"]).toMatchObject({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
    expect(metrics.perStatType["FG2_MADE"]).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 0 });
    expect(metrics.perStatType["FT_MADE"]).toMatchObject({ truePositives: 0, falsePositives: 0, falseNegatives: 1 });
  });

  it("reports per-quarter recall only, keyed off the ground truth's quarter", () => {
    const metrics = computeBenchmarkMetrics(
      [ai("a1", "p1", "FG2_MADE", 100)],
      [gt("g1", "p1", "FG2_MADE", 100, 1), gt("g2", "p1", "FG3_MADE", 500, 2)],
      5
    );
    expect(metrics.perQuarter[1]).toMatchObject({ groundTruthEvents: 1, truePositives: 1, falseNegatives: 0, recall: 1 });
    expect(metrics.perQuarter[2]).toMatchObject({ groundTruthEvents: 1, truePositives: 0, falseNegatives: 1, recall: 0 });
  });

  it("tallies false-negative stage counts across the whole run", () => {
    const metrics = computeBenchmarkMetrics(
      [ai("a1", "p1", "FG3_MADE", 100)], // wrong type near g1
      [gt("g1", "p1", "FG2_MADE", 100), gt("g2", "p1", "FT_MADE", 900)], // g2 has nothing nearby
      5
    );
    expect(metrics.falseNegativeStageCounts.wrong_event_type).toBe(1);
    expect(metrics.falseNegativeStageCounts.no_ai_event_nearby).toBe(1);
    expect(metrics.classifiedFalseNegatives).toHaveLength(2);
  });
});
