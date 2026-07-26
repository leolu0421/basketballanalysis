import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  readScoreboardBatch,
  guessCandidateStatsBatch,
  guessCandidateFromTracks,
  type FrameRead,
  type CandidateToGuess,
  type TrackToGuess,
} from "./vision";
import { buildScoreCandidates, type ScoreCandidate } from "./candidates";

const FRAME_INTERVAL_SECONDS = 15;
const FRAMES_PER_VISION_CALL = 10;
const CANDIDATES_PER_GUESS_CALL = 4;
const TRACK_CLIP_PADDING_SECONDS = 4;
const TRACK_SAMPLE_FPS = 5;
const TRACK_SCRIPT_PATH = path.join(process.cwd(), "scripts", "track_players.py");
const CLASSIFY_SCRIPT_PATH = path.join(process.cwd(), "scripts", "classify_jersey.py");
const JERSEY_MODEL_DIR = path.join(process.cwd(), "models", "jersey");
const LOCAL_MODEL_CONFIDENCE_THRESHOLD = 0.6;

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

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to run ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

async function hasTrainedJerseyModel(): Promise<boolean> {
  try {
    await access(path.join(JERSEY_MODEL_DIR, "jersey_classifier.pt"));
    await access(path.join(JERSEY_MODEL_DIR, "jersey_classes.json"));
    return true;
  } catch {
    return false;
  }
}

type JerseyPrediction = { crop: string; label: string; confidence: number };

/**
 * Runs your own trained jersey classifier (scripts/train_jersey_classifier.py
 * output, see README) on a set of crops. Returns null on any failure —
 * missing model, bad input, python error — so callers can fall back to the
 * Claude-vision jersey read without this ever blocking the job.
 */
async function classifyCropsLocally(crops: string[]): Promise<JerseyPrediction[] | null> {
  if (crops.length === 0) return null;
  try {
    const stdout = await runCapture("python3", [CLASSIFY_SCRIPT_PATH, JERSEY_MODEL_DIR, ...crops]);
    const parsed = JSON.parse(stdout) as { predictions?: JerseyPrediction[]; error?: string };
    return parsed.predictions ?? null;
  } catch (err) {
    console.error("classifyCropsLocally failed:", err);
    return null;
  }
}

async function updateJob(
  jobId: string,
  data: Partial<{ status: string; progress: number; errorMessage: string | null }>
) {
  await prisma.videoAnalysisJob.update({ where: { id: jobId }, data });
}

type RosterPlayer = { id: string; jerseyNumber: string; firstName: string; lastName: string };
type CandidateGuessResult = { jerseyNumber: string | null; statType: string | null; playerId: string | null };

function resolvePlayerId(
  jerseyNumber: string | null,
  roster: RosterPlayer[]
): string | null {
  if (!jerseyNumber) return null;
  const player = roster.find(
    (p) => p.jerseyNumber.trim().toLowerCase() === jerseyNumber.trim().toLowerCase()
  );
  return player?.id ?? null;
}

/**
 * Runs YOLO person detection + ByteTrack tracking (scripts/track_players.py)
 * on a short clip around a candidate's timestamp, returning cropped torso
 * images per tracked person — zoomed close-ups read jersey numbers far more
 * reliably than a wide-shot frame. Requires Python 3 + the deps in
 * requirements.txt on the host; throws if unavailable so the caller can fall
 * back to the wide-frame approach.
 */
async function trackCandidate(
  videoPath: string,
  workDir: string,
  index: number,
  timestampSeconds: number
): Promise<TrackToGuess[]> {
  const clipStart = Math.max(0, timestampSeconds - TRACK_CLIP_PADDING_SECONDS);
  const clipDuration = TRACK_CLIP_PADDING_SECONDS * 2;
  const clipPath = path.join(workDir, "clips", `candidate_${index}.mp4`);
  const trackOutDir = path.join(workDir, "tracks", `candidate_${index}`);
  await mkdir(path.dirname(clipPath), { recursive: true });

  await run("ffmpeg", [
    "-ss",
    String(clipStart),
    "-i",
    videoPath,
    "-t",
    String(clipDuration),
    "-an",
    clipPath,
  ]);

  await run("python3", [
    TRACK_SCRIPT_PATH,
    clipPath,
    trackOutDir,
    "--fps",
    String(TRACK_SAMPLE_FPS),
    "--start",
    "0",
    "--end",
    String(clipDuration),
  ]);

  const raw = await readFile(path.join(trackOutDir, "tracks.json"), "utf-8");
  const parsed = JSON.parse(raw) as { tracks: { trackId: number; crops: string[] }[] };
  return parsed.tracks;
}

/**
 * For each score-change candidate, tries to identify the scoring player via
 * the tracking + cropped-jersey pipeline first, falling back to the older
 * wide-frame guess if tracking isn't available on this host (or fails) —
 * once tracking fails once, later candidates skip straight to the fallback
 * rather than retrying a broken pipeline per candidate. Best-effort
 * throughout: a failure just leaves a candidate unguessed rather than
 * failing the whole job, since the scoreboard candidates are still useful
 * on their own.
 *
 * If a jersey classifier has been trained (see
 * scripts/train_jersey_classifier.py — it only ever learns to read digits
 * off a jersey, deliberately not tied to any specific team/season/roster),
 * its jersey-number read overrides Claude's when confident. Whether that
 * number belongs to one of THIS match's current players is then resolved
 * the same way either path resolves it: a live lookup against the team's
 * current roster (resolvePlayerId below), not anything from training.
 * statType always still comes from Claude, since the classifier only
 * identifies jersey numbers.
 */
async function guessCandidatePlayers(
  candidates: ScoreCandidate[],
  videoPath: string,
  workDir: string,
  framesDir: string,
  frameFiles: string[],
  roster: RosterPlayer[]
): Promise<Array<CandidateGuessResult | undefined>> {
  const results: Array<CandidateGuessResult | undefined> = new Array(candidates.length).fill(undefined);
  if (roster.length === 0) return results;

  const useLocalModel = await hasTrainedJerseyModel();

  let trackingAvailable = true;
  const fallbackIndices: number[] = [];

  for (let index = 0; index < candidates.length; index++) {
    if (!trackingAvailable) {
      fallbackIndices.push(index);
      continue;
    }

    const candidate = candidates[index];
    try {
      const tracks = await trackCandidate(videoPath, workDir, index, candidate.videoTimestampSeconds);
      const guess = await guessCandidateFromTracks(
        { previousScoreText: candidate.previousScoreText, scoreText: candidate.scoreText },
        tracks,
        roster
      );

      let jerseyNumber = guess.jerseyNumber;
      if (useLocalModel) {
        const allCrops = tracks.flatMap((t) => t.crops);
        const predictions = await classifyCropsLocally(allCrops);
        const best = predictions
          ?.filter((p) => p.confidence >= LOCAL_MODEL_CONFIDENCE_THRESHOLD)
          .filter((p) => resolvePlayerId(p.label, roster) !== null)
          .sort((a, b) => b.confidence - a.confidence)[0];
        if (best) jerseyNumber = best.label;
      }

      results[index] = {
        jerseyNumber,
        statType: guess.statType,
        playerId: resolvePlayerId(jerseyNumber, roster),
      };
    } catch (err) {
      console.error(
        `Tracking-based guess failed (candidate ${index}) — falling back to wide-frame guessing for remaining candidates:`,
        err
      );
      trackingAvailable = false;
      fallbackIndices.push(index);
    }
  }

  if (fallbackIndices.length > 0) {
    const toGuess: CandidateToGuess[] = fallbackIndices.map((index) => {
      const c = candidates[index];
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
          results[guess.candidateIndex] = {
            jerseyNumber: guess.jerseyNumber,
            statType: guess.statType,
            playerId: resolvePlayerId(guess.jerseyNumber, roster),
          };
        }
      } catch (err) {
        console.error("guessCandidateStatsBatch failed for a batch:", err);
      }
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
        videoPath,
        workDir,
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
