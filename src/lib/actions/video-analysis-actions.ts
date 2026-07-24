"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { isAiConfigured } from "@/lib/ai/insights";
import { runVideoAnalysisJob } from "@/lib/video-analysis/pipeline";

export type VideoAnalysisActionState = { error?: string } | undefined;

export async function startVideoAnalysisAction(
  matchId: string
): Promise<VideoAnalysisActionState> {
  const { team } = await requireTeam();

  if (!isAiConfigured()) {
    return { error: "AI isn't configured yet — set ANTHROPIC_API_KEY." };
  }

  let jobId: string;
  let youtubeVideoId: string;
  try {
    const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
    if (!match) return { error: "Match not found" };
    if (!match.youtubeVideoId) return { error: "This match has no linked YouTube video." };
    youtubeVideoId = match.youtubeVideoId;

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
  void runVideoAnalysisJob(jobId, youtubeVideoId);

  revalidatePath(`/matches/${matchId}`);
  return undefined;
}

export async function getVideoAnalysisStatus(matchId: string) {
  const { team } = await requireTeam();
  const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
  if (!match) return null;

  const job = await prisma.videoAnalysisJob.findFirst({
    where: { matchId },
    orderBy: { createdAt: "desc" },
    include: { candidates: { where: { dismissed: false }, orderBy: { videoTimestampSeconds: "asc" } } },
  });

  return job;
}

export async function dismissCandidateAction(candidateId: string, matchId: string) {
  const { team } = await requireTeam();
  const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
  if (!match) throw new Error("Match not found");

  await prisma.videoAnalysisCandidate.updateMany({
    where: { id: candidateId, job: { matchId } },
    data: { dismissed: true },
  });

  revalidatePath(`/matches/${matchId}`);
}
