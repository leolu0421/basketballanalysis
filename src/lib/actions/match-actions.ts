"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { extractYoutubeId } from "@/lib/youtube";
import { STAT_TYPES } from "@/lib/stat-types";

export type MatchActionState = { error?: string } | undefined;

const matchSchema = z.object({
  opponentName: z.string().min(1, "Opponent name is required"),
  date: z.string().min(1, "Date is required"),
  youtubeUrl: z.string().optional(),
});

export async function createMatchAction(
  _prevState: MatchActionState,
  formData: FormData
): Promise<MatchActionState> {
  const { team } = await requireTeam();

  const parsed = matchSchema.safeParse({
    opponentName: formData.get("opponentName"),
    date: formData.get("date"),
    youtubeUrl: formData.get("youtubeUrl") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let youtubeVideoId: string | null = null;
  if (parsed.data.youtubeUrl) {
    youtubeVideoId = extractYoutubeId(parsed.data.youtubeUrl);
    if (!youtubeVideoId) {
      return { error: "Couldn't parse that YouTube link. Paste the full video URL." };
    }
  }

  let matchId: string;
  try {
    const match = await prisma.match.create({
      data: {
        teamId: team.id,
        opponentName: parsed.data.opponentName,
        date: new Date(parsed.data.date),
        youtubeVideoId,
      },
    });
    matchId = match.id;
  } catch (err) {
    console.error("createMatchAction failed:", err);
    return { error: "Something went wrong. Try again in a moment." };
  }

  revalidatePath("/matches");
  redirect(`/matches/${matchId}`);
}

export async function deleteMatchAction(matchId: string) {
  const { team } = await requireTeam();
  const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
  if (!match) redirect("/matches");
  if (match.isBenchmark) {
    // Benchmark matches back AI-pipeline evaluation comparisons (see
    // AnalysisSummary) — require explicitly un-marking one on the /eval
    // page before it can be deleted, so it's never lost by accident.
    console.warn(`deleteMatchAction refused: ${matchId} is a benchmark match`);
    redirect(`/matches/${matchId}`);
  }
  await prisma.match.deleteMany({ where: { id: matchId, teamId: team.id } });
  revalidatePath("/matches");
  redirect("/matches");
}

export async function setBenchmarkMatchAction(matchId: string, isBenchmark: boolean) {
  const { team } = await requireTeam();
  await prisma.match.updateMany({ where: { id: matchId, teamId: team.id }, data: { isBenchmark } });
  revalidatePath("/matches");
  revalidatePath("/eval");
}

const scoreSchema = z.object({
  teamScore: z.coerce.number().int().min(0),
  opponentScore: z.coerce.number().int().min(0),
});

export async function updateMatchScoreAction(
  matchId: string,
  _prevState: MatchActionState,
  formData: FormData
): Promise<MatchActionState> {
  const { team } = await requireTeam();
  const parsed = scoreSchema.safeParse({
    teamScore: formData.get("teamScore"),
    opponentScore: formData.get("opponentScore"),
  });
  if (!parsed.success) {
    return { error: "Enter valid scores" };
  }

  try {
    await prisma.match.updateMany({
      where: { id: matchId, teamId: team.id },
      data: parsed.data,
    });
  } catch (err) {
    console.error("updateMatchScoreAction failed:", err);
    return { error: "Something went wrong. Try again in a moment." };
  }
  revalidatePath(`/matches/${matchId}`);
  return undefined;
}

const statEventSchema = z.object({
  matchId: z.string().min(1),
  playerId: z.string().min(1),
  type: z.enum(STAT_TYPES),
  quarter: z.coerce.number().int().min(1).max(6),
  videoTimestampSeconds: z.coerce.number().optional(),
  shotX: z.coerce.number().min(0).max(1).optional(),
  shotY: z.coerce.number().min(0).max(1).optional(),
});

export async function logStatEventAction(input: {
  matchId: string;
  playerId: string;
  type: string;
  quarter: number;
  videoTimestampSeconds?: number;
  shotX?: number;
  shotY?: number;
}) {
  const { team } = await requireTeam();

  const parsed = statEventSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid stat event");
  }

  const match = await prisma.match.findFirst({
    where: { id: parsed.data.matchId, teamId: team.id },
  });
  if (!match) throw new Error("Match not found");

  await prisma.statEvent.create({ data: parsed.data });
  revalidatePath(`/matches/${parsed.data.matchId}`);
  revalidatePath("/stats");
  revalidatePath("/performance");
}

export async function deleteStatEventAction(eventId: string, matchId: string) {
  const { team } = await requireTeam();
  const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
  if (!match) throw new Error("Match not found");

  await prisma.statEvent.delete({ where: { id: eventId } });
  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/stats");
  revalidatePath("/performance");
}
