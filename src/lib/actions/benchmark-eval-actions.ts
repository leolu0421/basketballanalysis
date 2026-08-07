"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import {
  computeBenchmarkMetrics,
  DEFAULT_MATCH_TOLERANCE_SECONDS,
  type AiEvent,
  type GroundTruthEvent,
} from "@/lib/benchmark-eval";

/**
 * Scores one completed video-analysis job's raw AI output against its
 * match's MANUAL-source ground truth, and stores the result.
 *
 * Candidates are fetched scoped strictly to this jobId (never
 * `job: { matchId }`, which would pull every job's candidates for the
 * match) — the defensive check right after the query exists specifically
 * because keeping different analysis runs from mixing together here is a
 * hard correctness requirement, not just a performance nicety: comparing
 * commit A vs. commit B is meaningless if a run's "AI predictions" could
 * silently include another run's candidates.
 */
export async function evaluateJobAction(
  jobId: string,
  toleranceSeconds: number = DEFAULT_MATCH_TOLERANCE_SECONDS
) {
  const { team } = await requireTeam();

  const job = await prisma.videoAnalysisJob.findFirst({
    where: { id: jobId, match: { teamId: team.id } },
    include: {
      match: true,
      summary: { select: { gitCommitHash: true } },
      candidates: true, // relation query — Prisma scopes this to candidates whose jobId === job.id
    },
  });
  if (!job) throw new Error("Analysis job not found");
  if (job.candidates.some((c) => c.jobId !== job.id)) {
    // Should be structurally impossible via the relation query above —
    // kept as a loud failure rather than a silent one, since a bug here
    // would quietly corrupt every accuracy number downstream.
    throw new Error("Internal error: candidates from another job leaked into this evaluation");
  }
  if (!job.match.isBenchmark) {
    throw new Error("This match isn't marked as a benchmark — mark it first so its ground truth is trustworthy.");
  }

  const groundTruthRows = await prisma.statEvent.findMany({
    where: { matchId: job.matchId, source: "MANUAL", videoTimestampSeconds: { not: null } },
  });
  if (groundTruthRows.length === 0) {
    throw new Error(
      "No MANUAL ground-truth events for this match yet — log or mark some first (AI_CONFIRMED and UNKNOWN rows don't count)."
    );
  }

  const aiEvents: AiEvent[] = job.candidates.map((c) => ({
    id: c.id,
    guessedPlayerId: c.guessedPlayerId,
    guessedStatType: c.guessedStatType,
    videoTimestampSeconds: c.videoTimestampSeconds,
    guessedJerseyNumber: c.guessedJerseyNumber,
    localizationMethod: c.localizationMethod,
  }));
  const groundTruth: GroundTruthEvent[] = groundTruthRows.map((g) => ({
    id: g.id,
    playerId: g.playerId,
    type: g.type,
    quarter: g.quarter,
    videoTimestampSeconds: g.videoTimestampSeconds as number, // filtered not-null above
  }));

  const metrics = computeBenchmarkMetrics(aiEvents, groundTruth, toleranceSeconds);

  const shared = {
    gitCommitHash: job.summary?.gitCommitHash ?? null,
    toleranceSeconds: metrics.toleranceSeconds,
    groundTruthEventCount: metrics.groundTruthEventCount,
    aiEventCount: metrics.aiEventCount,
    truePositives: metrics.overall.truePositives,
    falsePositives: metrics.overall.falsePositives,
    falseNegatives: metrics.overall.falseNegatives,
    precision: metrics.overall.precision,
    recall: metrics.overall.recall,
    f1: metrics.overall.f1,
    perPlayerBreakdown: metrics.perPlayer,
    perStatTypeBreakdown: metrics.perStatType,
    perQuarterBreakdown: metrics.perQuarter,
    falseNegativeStageBreakdown: metrics.falseNegativeStageCounts,
  };

  await prisma.benchmarkEvaluation.upsert({
    where: { jobId },
    create: { jobId, matchId: job.matchId, ...shared },
    update: { ...shared, evaluatedAt: new Date() },
  });

  revalidatePath("/eval");
  revalidatePath("/eval/compare");
  revalidatePath(`/matches/${job.matchId}`);
}

export async function getBenchmarkEvaluations(options: { sort?: "asc" | "desc" } = {}) {
  const { team } = await requireTeam();
  const sort = options.sort === "asc" ? "asc" : "desc";

  return prisma.benchmarkEvaluation.findMany({
    where: { match: { teamId: team.id } },
    include: { match: { select: { id: true, opponentName: true, date: true } } },
    orderBy: { evaluatedAt: sort },
  });
}

export async function getBenchmarkEvaluationById(id: string) {
  const { team } = await requireTeam();
  return prisma.benchmarkEvaluation.findFirst({
    where: { id, match: { teamId: team.id } },
    include: { match: { select: { id: true, opponentName: true, date: true } } },
  });
}

export async function getBenchmarkEvaluationByJobId(jobId: string) {
  const { team } = await requireTeam();
  return prisma.benchmarkEvaluation.findFirst({
    where: { jobId, match: { teamId: team.id } },
  });
}

/** Player id -> "#N First" label lookup, for rendering perPlayerBreakdown on /eval/compare. */
export async function getPlayerLabels(playerIds: string[]) {
  const { team } = await requireTeam();
  if (playerIds.length === 0) return {};

  const players = await prisma.player.findMany({
    where: { id: { in: playerIds }, teamId: team.id },
    select: { id: true, firstName: true, jerseyNumber: true },
  });
  return Object.fromEntries(players.map((p) => [p.id, `#${p.jerseyNumber} ${p.firstName}`])) as Record<
    string,
    string
  >;
}

/** MANUAL-source ground-truth event count per benchmark match, for the /eval table. */
export async function getGroundTruthCounts(matchIds: string[]) {
  const { team } = await requireTeam();
  if (matchIds.length === 0) return {};

  const rows = await prisma.statEvent.groupBy({
    by: ["matchId"],
    where: { matchId: { in: matchIds }, source: "MANUAL", match: { teamId: team.id } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.matchId, r._count._all])) as Record<string, number>;
}
