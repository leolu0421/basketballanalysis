import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { readScoreboardBatch, guessCandidateStatsBatch, type FrameRead, type CandidateToGuess } from "./vision";
import { buildScoreCandidates, type ScoreCandidate } from "./candidates";

const FRAME_INTERVAL_SECONDS = 15;
const FRAMES_PER_VISION_CALL = 10;
const CANDIDATES_PER_GUESS_CALL = 4;

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

type RosterPlayer = { id: string; jerseyNumber: string; firstName: string; lastName: string };
type CandidateGuessResult = { jerseyNumber: string | null; statType: string | null; playerId: string | null };

/**
 * For each score-change candidate, grabs the short frame sequence around its
 * timestamp and asks Claude vision to guess the scoring player + shot type.
 * Best-effort: a failed batch just leaves those candidates unguessed rather
 * than failing the whole job, since the scoreboard candidates are still
 * useful on their own.
 */
async function guessCandidatePlayers(
  candidates: ScoreCandidate[],
  framesDir: string,
  frameFiles: string[],
  roster: RosterPlayer[]
): Promise<Array<CandidateGuessResult | undefined>> {
  const results: Array<CandidateGuessResult | undefined> = new Array(candidates.length).fill(undefined);
  if (roster.length === 0) return results;

  const toGuess: CandidateToGuess[] = candidates.map((c, index) => {
    const centerIndex = Math.round(c.videoTimestampSeconds / FRAME_INTERVAL_SECONDS);
    const frameIndices = [centerIndex - 1, centerIndex, centerIndex + 1].filter(
      (i, idx, arr) => i >= 0 && i < frameFiles.length && arr.indexOf(i) === idx
    );
    return {
      index,
      previousScoreText: c.previousScoreText,
      scoreText: c.scoreText,
      frames: frameIndices.map((i) => ({
        path: path.join(framesDir, frameFiles[i]),
        timestampSeconds: i * FRAME_INTERVAL_SECONDS,
      })),
    };
  });

  for (let i = 0; i < toGuess.length; i += CANDIDATES_PER_GUESS_CALL) {
    const batch = toGuess.slice(i, i + CANDIDATES_PER_GUESS_CALL);
    try {
      const guesses = await guessCandidateStatsBatch(batch, roster);
      for (const guess of guesses) {
        const player = guess.jerseyNumber
          ? roster.find(
              (p) => p.jerseyNumber.trim().toLowerCase() === guess.jerseyNumber!.trim().toLowerCase()
            )
          : undefined;
        results[guess.candidateIndex] = {
          jerseyNumber: guess.jerseyNumber,
          statType: guess.statType,
          playerId: player?.id ?? null,
        };
      }
    } catch (err) {
      console.error("guessCandidateStatsBatch failed for a batch:", err);
    }
  }

  return results;
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
    const job = await prisma.videoAnalysisJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { match: { include: { team: { include: { players: true } } } } },
    });
    const roster = job.match.team.players.map((p) => ({
      id: p.id,
      jerseyNumber: p.jerseyNumber,
      firstName: p.firstName,
      lastName: p.lastName,
    }));

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
      await updateJob(jobId, { status: "MATCHING", progress: 96 });
      const guesses = await guessCandidatePlayers(
        candidates,
        framesDir,
        frameFiles,
        roster
      );

      await prisma.videoAnalysisCandidate.createMany({
        data: candidates.map((c, i) => ({
          jobId,
          ...c,
          guessedJerseyNumber: guesses[i]?.jerseyNumber ?? null,
          guessedStatType: guesses[i]?.statType ?? null,
          guessedPlayerId: guesses[i]?.playerId ?? null,
        })),
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
