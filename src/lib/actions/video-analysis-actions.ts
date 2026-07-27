"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { isAiConfigured } from "@/lib/ai/insights";
import { runVideoAnalysisJob, type VideoSource } from "@/lib/video-analysis/pipeline";
import { videoStoragePathFor } from "@/lib/video-storage";

export type VideoAnalysisActionState = { error?: string } | undefined;

export async function startVideoAnalysisAction(
  matchId: string
): Promise<VideoAnalysisActionState> {
  const { team } = await requireTeam();

  if (!isAiConfigured()) {
    return { error: "AI isn't configured yet — set ANTHROPIC_API_KEY." };
  }

  let jobId: string;
  let videoSource: VideoSource;
  try {
    const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
    if (!match) return { error: "Match not found" };
    if (match.videoFileName) {
      videoSource = { type: "file", filePath: videoStoragePathFor(matchId, match.videoFileName) };
    } else if (match.youtubeVideoId) {
      videoSource = { type: "youtube", youtubeVideoId: match.youtubeVideoId };
    } else {
      return { error: "This match has no video linked or uploaded yet." };
    }

    const job = await prisma.videoAnalysisJob.create({
      data: { matchId, status: "PENDING" },
    });
    jobId = job.id;
  } catch (err) {
    console.error("startVideoAnalysisAction failed:", err);
    return { error: "Something went wrong. Try again in a moment." };
  }

  // Fire-and-forget: the pipeline runs in the background and updates the job
  // row as it progresses. It handles its own errors internally.
  void runVideoAnalysisJob(jobId, videoSource);

  revalidatePath(`/matches/${matchId}`);
  return undefined;
}

export async function getVideoAnalysisStatus(matchId: string) {
  const { team } = await requireTeam();
  try {
    const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
    if (!match) return null;

    const job = await prisma.videoAnalysisJob.findFirst({
      where: { matchId },
      orderBy: { createdAt: "desc" },
      include: { candidates: { where: { dismissed: false }, orderBy: { videoTimestampSeconds: "asc" } } },
    });

    return job;
  } catch (err) {
    console.error("getVideoAnalysisStatus failed:", err);
    return null;
  }
}

export async function dismissCandidateAction(candidateId: string, matchId: string) {
  const { team } = await requireTeam();
  try {
    const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
    if (!match) return;

    await prisma.videoAnalysisCandidate.updateMany({
      where: { id: candidateId, job: { matchId } },
      data: { dismissed: true },
    });
  } catch (err) {
    console.error("dismissCandidateAction failed:", err);
    return;
  }

  revalidatePath(`/matches/${matchId}`);
}

const confirmSchema = z.object({
  playerId: z.string().min(1, "Choose a player"),
  type: z.enum(["FG2_MADE", "FG3_MADE", "FT_MADE"]),
  quarter: z.coerce.number().int().min(1).max(6),
});

export async function confirmCandidateAction(
  candidateId: string,
  matchId: string,
  input: { playerId: string; type: string; quarter: number }
): Promise<VideoAnalysisActionState> {
  const { team } = await requireTeam();

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
    if (!match) return { error: "Match not found" };

    const player = await prisma.player.findFirst({
      where: { id: parsed.data.playerId, teamId: team.id },
    });
    if (!player) return { error: "Player not found" };

    const candidate = await prisma.videoAnalysisCandidate.findFirst({
      where: { id: candidateId, job: { matchId } },
    });
    if (!candidate) return { error: "Suggestion not found" };

    await prisma.$transaction([
      prisma.statEvent.create({
        data: {
          matchId,
          playerId: parsed.data.playerId,
          type: parsed.data.type,
          quarter: parsed.data.quarter,
          videoTimestampSeconds: candidate.videoTimestampSeconds,
        },
      }),
      prisma.videoAnalysisCandidate.update({
        where: { id: candidateId },
        data: { dismissed: true },
      }),
    ]);
  } catch (err) {
    console.error("confirmCandidateAction failed:", err);
    return { error: "Something went wrong. Try again in a moment." };
  }

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/stats");
  revalidatePath("/performance");
  return undefined;
}
