"use server";

import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";

export type AnalysisSummaryRow = Awaited<ReturnType<typeof getAnalysisSummaries>>[number];

/**
 * Internal QA listing — every AnalysisSummary for this team's matches, for
 * the /eval page. Not shown to coaches.
 */
export async function getAnalysisSummaries(options: { benchmarkOnly?: boolean; sort?: "asc" | "desc" } = {}) {
  const { team } = await requireTeam();
  const sort = options.sort === "asc" ? "asc" : "desc";

  return prisma.analysisSummary.findMany({
    where: {
      match: {
        teamId: team.id,
        ...(options.benchmarkOnly ? { isBenchmark: true } : {}),
      },
    },
    include: { match: { select: { id: true, opponentName: true, date: true, isBenchmark: true } } },
    orderBy: { analyzedAt: sort },
  });
}

export async function getAnalysisSummaryById(id: string) {
  const { team } = await requireTeam();
  return prisma.analysisSummary.findFirst({
    where: { id, match: { teamId: team.id } },
    include: { match: { select: { id: true, opponentName: true, date: true, isBenchmark: true } } },
  });
}
