"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { computeBoxScoreByPlayer, sumBoxScoreLines, computeTeamInsightsMetrics } from "@/lib/stats";
import {
  generateTeamInsights,
  isAiConfigured,
  AiNotConfiguredError,
  AI_INSIGHTS_MODEL,
  TeamInsightsSchema,
  type TeamInsights,
} from "@/lib/ai/insights";

export type InsightsActionState = { error?: string } | undefined;

export async function getCachedTeamInsights(
  matchId: string
): Promise<TeamInsights | null> {
  const row = await prisma.insight.findUnique({
    where: { matchId_scope: { matchId, scope: "TEAM" } },
  });
  if (!row) return null;

  const parsed = TeamInsightsSchema.safeParse(JSON.parse(row.content));
  return parsed.success ? parsed.data : null;
}

export async function refreshTeamInsightsAction(
  matchId: string
): Promise<InsightsActionState> {
  const { team } = await requireTeam();

  if (!isAiConfigured()) {
    return { error: "AI insights aren't configured yet — set ANTHROPIC_API_KEY." };
  }

  const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
  if (!match) return { error: "Match not found" };

  const events = await prisma.statEvent.findMany({ where: { matchId } });
  if (events.length === 0) {
    return { error: "Tag some stats for this match before generating insights." };
  }

  const teamLine = sumBoxScoreLines(Object.values(computeBoxScoreByPlayer(events)));
  const metrics = computeTeamInsightsMetrics(teamLine);

  try {
    const insights = await generateTeamInsights({
      teamName: team.name,
      opponentName: match.opponentName,
      teamScore: match.teamScore,
      opponentScore: match.opponentScore,
      metrics,
    });

    await prisma.insight.upsert({
      where: { matchId_scope: { matchId, scope: "TEAM" } },
      create: {
        matchId,
        scope: "TEAM",
        content: JSON.stringify(insights),
        model: AI_INSIGHTS_MODEL,
      },
      update: {
        content: JSON.stringify(insights),
        model: AI_INSIGHTS_MODEL,
      },
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return { error: "AI insights aren't configured yet — set ANTHROPIC_API_KEY." };
    }
    return { error: "Something went wrong generating insights. Try again." };
  }

  revalidatePath("/insights");
  return undefined;
}
