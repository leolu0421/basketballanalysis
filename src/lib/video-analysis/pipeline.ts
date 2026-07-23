import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { readScoreboardBatch, type FrameRead } from "./vision";
import { buildScoreCandidates } from "./candidates";

const FRAME_INTERVAL_SECONDS = 15;
const FRAMES_PER_VISION_CALL = 10;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to run ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

async function updateJob(
  jobId: string,
  data: Partial<{ status: string; progress: number; errorMessage: string | null }>
) {
  await prisma.videoAnalysisJob.update({ where: { id: jobId }, data });
}

/**
 * Downloads the linked YouTube video, samples frames at a fixed interval,
 * reads the on-screen scoreboard in each via Claude vision, and stores a
 * candidate row for every detected score change. Runs entirely server-side
 * in the background — the caller does not await this to completion.
 *
 * Requires `yt-dlp` and `ffmpeg` on the host. Not viable on serverless
 * platforms without a persistent worker (no long-running child processes).
 */
export async function runVideoAnalysisJob(jobId: string, youtubeVideoId: string) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "video-analysis-"));

  try {
    await updateJob(jobId, { status: "DOWNLOADING", progress: 5 });

    await run("yt-dlp", [
      "-f",
      "worst[ext=mp4][height>=360]/worst[height>=360]/worst",
      "--no-playlist",
      "-o",
      path.join(workDir, "video.%(ext)s"),
      `https://www.youtube.com/watch?v=${youtubeVideoId}`,
    ]);

    const downloadedName = (await readdir(workDir)).find((f) => f.startsWith("video."));
    if (!downloadedName) {
      throw new Error("yt-dlp finished but no video file was found");
    }
    const videoPath = path.join(workDir, downloadedName);

    await updateJob(jobId, { status: "EXTRACTING", progress: 30 });

    const framesDir = path.join(workDir, "frames");
    await mkdir(framesDir, { recursive: true });

    await run("ffmpeg", [
      "-i",
      videoPath,
      "-vf",
      `fps=1/${FRAME_INTERVAL_SECONDS}`,
      "-q:v",
      "5",
      path.join(framesDir, "frame_%05d.jpg"),
    ]);

    const frameFiles = (await readdir(framesDir)).filter((f) => f.endsWith(".jpg")).sort();
    if (frameFiles.length === 0) {
      throw new Error("No frames were extracted from the video");
    }

    await updateJob(jobId, { status: "ANALYZING", progress: 40 });

    const allReads: FrameRead[] = [];
    for (let i = 0; i < frameFiles.length; i += FRAMES_PER_VISION_CALL) {
      const batch = frameFiles.slice(i, i + FRAMES_PER_VISION_CALL).map((file, j) => ({
        index: i + j,
        path: path.join(framesDir, file),
        timestampSeconds: (i + j) * FRAME_INTERVAL_SECONDS,
      }));

      const reads = await readScoreboardBatch(batch);
      allReads.push(...reads);

      const pct = 40 + Math.round(((i + batch.length) / frameFiles.length) * 55);
      await updateJob(jobId, { progress: Math.min(pct, 95) });
    }

    const candidates = buildScoreCandidates(allReads, FRAME_INTERVAL_SECONDS);
    if (candidates.length > 0) {
      await prisma.videoAnalysisCandidate.createMany({
        data: candidates.map((c) => ({ jobId, ...c })),
      });
    }

    await updateJob(jobId, { status: "DONE", progress: 100 });
  } catch (err) {
    await updateJob(jobId, {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
