import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  readScoreboardBatch,
  guessCandidateStatsBatch,
  guessCandidateFromTracks,
  localizeScoringMoment,
  type FrameRead,
  type CandidateToGuess,
  type TrackToGuess,
  type EventLocalizationResult,
  type LocalizationCandidateFrame,
} from "./vision";
import {
  buildScoreCandidates,
  isPlausibleScoreDelta,
  type ScoreCandidate,
  type BuildCandidatesStats,
} from "./candidates";
import { computeLocalizationWindow, summarizeLocalizations } from "./localization";

const FRAME_INTERVAL_SECONDS = 15;
const FRAMES_PER_VISION_CALL = 10;
const CANDIDATES_PER_GUESS_CALL = 4;
const TRACK_CLIP_PADDING_SECONDS = 4;
const MAX_TRACK_CLIP_DURATION_SECONDS = 45;
const TRACK_SAMPLE_FPS = 5;
const LOCALIZATION_SAMPLE_INTERVAL_SECONDS = 1;
const LOCALIZED_CLIP_BEFORE_SECONDS = 5;
const LOCALIZED_CLIP_AFTER_SECONDS = 2;
const FFMPEG_LOCALIZATION_TIMEOUT_MS = 1 * 60 * 1000;
const TRACK_SCRIPT_PATH = path.join(process.cwd(), "scripts", "track_players.py");
const CLASSIFY_SCRIPT_PATH = path.join(process.cwd(), "scripts", "classify_jersey.py");
const JERSEY_MODEL_DIR = path.join(process.cwd(), "models", "jersey");
const LOCAL_MODEL_CONFIDENCE_THRESHOLD = 0.6;

// Generous but bounded — confirmed in production that an unbounded child
// process (no timeout at all, previously) can leave a job stuck showing
// "Analyzing…" indefinitely under constrained CPU with nothing to catch it.
const YTDLP_TIMEOUT_MS = 15 * 60 * 1000;
const FFMPEG_FULL_VIDEO_TIMEOUT_MS = 10 * 60 * 1000;
const FFMPEG_CLIP_TIMEOUT_MS = 2 * 60 * 1000;
const TRACK_TIMEOUT_MS = 3 * 60 * 1000;
const CLASSIFY_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Confirmed in production: a hung (or just very slow, under constrained
 * CPU) child process here previously left a job stuck showing "Analyzing…"
 * for hours with nothing to catch it, since close/error never fired. Every
 * call site now passes an explicit timeoutMs so a stuck process gets
 * killed and the promise rejects instead of hanging forever.
 */
function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to run ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s and was killed`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-1500)}`));
      }
    });
  });
}

function runCapture(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to run ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s and was killed`));
      } else if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-1500)}`));
      }
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
    const stdout = await runCapture(
      "python3",
      [CLASSIFY_SCRIPT_PATH, JERSEY_MODEL_DIR, ...crops],
      CLASSIFY_TIMEOUT_MS
    );
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
 * The full scoreboard-obscured gap, capped so a single long stoppage
 * doesn't blow up processing time. Used as the tracking-clip window only
 * when event localization (below) fails or isn't confident — otherwise the
 * much tighter localized-timestamp window is used instead.
 */
function gapBasedClipWindow(gapStartSeconds: number, gapEndSeconds: number): { start: number; duration: number } {
  const center = (gapStartSeconds + gapEndSeconds) / 2;
  const desiredDuration = Math.min(
    gapEndSeconds - gapStartSeconds + TRACK_CLIP_PADDING_SECONDS * 2,
    MAX_TRACK_CLIP_DURATION_SECONDS
  );
  return { start: Math.max(0, center - desiredDuration / 2), duration: desiredDuration };
}

/**
 * Extracts frames densely sampled from a candidate's localization search
 * window (see localization.ts), for localizeScoringMoment to inspect.
 */
async function extractLocalizationFrames(
  videoPath: string,
  workDir: string,
  index: number,
  window: { start: number; end: number }
): Promise<{ index: number; path: string; timestampSeconds: number }[]> {
  const framesDir = path.join(workDir, "localization", `candidate_${index}`);
  await mkdir(framesDir, { recursive: true });
  const duration = Math.max(0.1, window.end - window.start);

  await run(
    "ffmpeg",
    [
      "-ss",
      String(window.start),
      "-i",
      videoPath,
      "-t",
      String(duration),
      "-vf",
      `fps=1/${LOCALIZATION_SAMPLE_INTERVAL_SECONDS}`,
      "-q:v",
      "5",
      path.join(framesDir, "frame_%05d.jpg"),
    ],
    FFMPEG_LOCALIZATION_TIMEOUT_MS
  );

  const files = (await readdir(framesDir)).filter((f) => f.endsWith(".jpg")).sort();
  return files.map((file, i) => ({
    index: i,
    path: path.join(framesDir, file),
    timestampSeconds: window.start + i * LOCALIZATION_SAMPLE_INTERVAL_SECONDS,
  }));
}

/**
 * Event localization stage: narrows a scoreboard-change candidate's whole
 * search gap down to the actual scoring frame, before any player/jersey
 * guessing happens. Best-effort — any failure (no ffmpeg, no frames, vision
 * call error) falls back to the gap's midpoint with confidence 0 rather
 * than throwing, so a single candidate's localization trouble never stops
 * the rest of the job.
 */
async function localizeCandidate(
  videoPath: string,
  workDir: string,
  index: number,
  candidate: { previousScoreText: string; scoreText: string; gapStartSeconds: number; gapEndSeconds: number }
): Promise<EventLocalizationResult> {
  const baseFallback = {
    localizedTimestampSeconds: (candidate.gapStartSeconds + candidate.gapEndSeconds) / 2,
    confidence: 0,
    // Unknown whether the shooter is visible anywhere in the (much wider,
    // unlocalized) gap — default to the safer assumption so the caller
    // widens the tracking clip rather than trusting a tight window blind.
    shooterVisible: false,
    topCandidates: [] as LocalizationCandidateFrame[],
  };

  try {
    const window = computeLocalizationWindow(candidate.gapStartSeconds, candidate.gapEndSeconds);
    const frames = await extractLocalizationFrames(videoPath, workDir, index, window);
    if (frames.length === 0) {
      return {
        ...baseFallback,
        reason: "ffmpeg extracted zero frames from the localization window",
        method: "fallback_no_evidence",
      };
    }
    return await localizeScoringMoment(frames, candidate);
  } catch (err) {
    // Distinct from the frames.length===0 case above: something actually
    // threw here (ffmpeg failure/timeout, an uncaught Claude API error),
    // not just "ran fine but found nothing" — see evaluation metrics
    // (Localization Failed) which rely on this distinction being accurate.
    console.error(`Event localization failed (candidate ${index}) — falling back to gap midpoint:`, err);
    return {
      ...baseFallback,
      reason: err instanceof Error ? err.message.slice(0, 300) : "Unknown localization error",
      method: "fallback_error",
    };
  }
}

/**
 * Runs YOLO person detection + ByteTrack tracking (scripts/track_players.py)
 * on a short clip, returning cropped torso images per tracked person —
 * zoomed close-ups read jersey numbers far more reliably than a wide-shot
 * frame. Requires Python 3 + the deps in requirements.txt on the host;
 * throws if unavailable so the caller can fall back to the wide-frame
 * approach.
 */
async function trackCandidate(
  videoPath: string,
  workDir: string,
  index: number,
  clipStart: number,
  clipDuration: number
): Promise<TrackToGuess[]> {
  const clipPath = path.join(workDir, "clips", `candidate_${index}.mp4`);
  const trackOutDir = path.join(workDir, "tracks", `candidate_${index}`);
  await mkdir(path.dirname(clipPath), { recursive: true });

  await run(
    "ffmpeg",
    ["-ss", String(clipStart), "-i", videoPath, "-t", String(clipDuration), "-an", clipPath],
    FFMPEG_CLIP_TIMEOUT_MS
  );

  await run(
    "python3",
    [
      TRACK_SCRIPT_PATH,
      clipPath,
      trackOutDir,
      "--fps",
      String(TRACK_SAMPLE_FPS),
      "--start",
      "0",
      "--end",
      String(clipDuration),
    ],
    TRACK_TIMEOUT_MS
  );

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
export async function guessCandidatePlayers(
  jobId: string,
  candidates: ScoreCandidate[],
  videoPath: string,
  workDir: string,
  framesDir: string,
  frameFiles: string[],
  roster: RosterPlayer[]
): Promise<{
  results: Array<CandidateGuessResult | undefined>;
  localizations: Array<EventLocalizationResult | undefined>;
}> {
  const results: Array<CandidateGuessResult | undefined> = new Array(candidates.length).fill(undefined);
  const localizations: Array<EventLocalizationResult | undefined> = new Array(candidates.length).fill(undefined);
  if (roster.length === 0) return { results, localizations };

  const useLocalModel = await hasTrainedJerseyModel();

  // Confirmed in production: a shared trackingAvailable flag here used to
  // permanently disable localization/tracking for every remaining candidate
  // the moment any ONE candidate's tracking step threw — e.g. one flaky
  // ffmpeg/YOLO run could rob a dozen unrelated, perfectly fine candidates
  // of a fair shot. Each candidate is now fully isolated: its own
  // try/catch, its own outcome, no shared state. A failure only affects
  // the candidate that actually failed.
  const fallbackIndices: number[] = [];

  for (let index = 0; index < candidates.length; index++) {
    // Keeps the job row's updatedAt fresh through a potentially long loop
    // (dozens of candidates, each with its own subprocess spawns) — a
    // stale-job safety net elsewhere in the app uses this to detect a
    // genuinely stuck job vs. one that's just working through a lot of
    // candidates.
    await updateJob(jobId, { progress: Math.min(99, 55 + Math.round((index / candidates.length) * 44)) });

    const candidate = candidates[index];
    const oldMidpoint = (candidate.gapStartSeconds + candidate.gapEndSeconds) / 2;

    // A candidate whose score delta isn't a plausible single basket (both
    // sides changed, or one side jumped by more than 3) has no single
    // scoring player to attribute, and no single scoring moment to localize
    // either — skip straight to leaving it unguessed (falls back to manual
    // entry in the UI, using the plain gap midpoint) rather than spend a
    // localization/tracking/vision call on an answer that can't be right.
    if (!isPlausibleScoreDelta(candidate.previousScoreText, candidate.scoreText)) {
      console.log(
        `[video-analysis] candidate ${index}: ${candidate.previousScoreText} -> ${candidate.scoreText}, ` +
          `gap ${candidate.gapStartSeconds}s-${candidate.gapEndSeconds}s, skipped (implausible delta)`
      );
      continue;
    }

    try {
      const localization = await localizeCandidate(videoPath, workDir, index, candidate);
      localizations[index] = localization;

      // Try each candidate frame (best-confidence first) in turn, stopping
      // as soon as one resolves to a roster player — this keeps the common
      // case (top candidate just works) at the same cost as before, while
      // still falling through to the next-best guess on harder candidates
      // instead of betting everything on a single frame pick. If the
      // shooter isn't visible at the localized frame, every attempt uses
      // the wider gap-based window instead of a tight one, since a tight
      // window anchored on a frame that doesn't even show the scorer isn't
      // worth trusting.
      const attempts =
        localization.method === "vision" && localization.topCandidates.length > 0
          ? localization.topCandidates
          : [{ timestampSeconds: localization.localizedTimestampSeconds, confidence: localization.confidence }];

      let chosen: CandidateGuessResult | undefined;
      let chosenWindow = gapBasedClipWindow(candidate.gapStartSeconds, candidate.gapEndSeconds);
      const attemptsLogged: string[] = [];

      for (const attempt of attempts) {
        const clipWindow = localization.shooterVisible
          ? {
              start: Math.max(0, attempt.timestampSeconds - LOCALIZED_CLIP_BEFORE_SECONDS),
              duration: LOCALIZED_CLIP_BEFORE_SECONDS + LOCALIZED_CLIP_AFTER_SECONDS,
            }
          : gapBasedClipWindow(candidate.gapStartSeconds, candidate.gapEndSeconds);

        const tracks = await trackCandidate(videoPath, workDir, index, clipWindow.start, clipWindow.duration);
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

        const playerId = resolvePlayerId(jerseyNumber, roster);
        attemptsLogged.push(`t=${attempt.timestampSeconds}s(conf ${attempt.confidence})->#${jerseyNumber ?? "?"}/${playerId ?? "unresolved"}`);
        chosen = { jerseyNumber, statType: guess.statType, playerId };
        chosenWindow = clipWindow;
        if (playerId !== null) break; // good enough — no need to try the remaining candidates
      }

      results[index] = chosen;

      console.log(
        `[video-analysis] candidate ${index}: ${candidate.previousScoreText} -> ${candidate.scoreText}, ` +
          `gap ${candidate.gapStartSeconds}s-${candidate.gapEndSeconds}s (old midpoint ${oldMidpoint}s), ` +
          `localized ${localization.localizedTimestampSeconds}s (confidence ${localization.confidence}, ${localization.method}, shooterVisible=${localization.shooterVisible}), ` +
          `attempts: [${attemptsLogged.join(", ")}], ` +
          `tracking clip ${chosenWindow.start}s-${chosenWindow.start + chosenWindow.duration}s, ` +
          `guessed jersey #${chosen?.jerseyNumber ?? "?"} -> player ${chosen?.playerId ?? "unresolved"}, stat ${chosen?.statType ?? "?"}`
      );
    } catch (err) {
      // Isolated to this candidate only — does not affect any other
      // candidate's chance at localization/tracking. localizations[index]
      // may already be set from a successful localizeCandidate() call
      // earlier in this same try block, even though the later
      // tracking/guess step is what actually threw; the wide-frame
      // fallback log below checks for that instead of assuming neither ran.
      console.error(`Tracking-based guess failed for candidate ${index} only (falls back to wide-frame guessing for this candidate):`, err);
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
          const playerId = resolvePlayerId(guess.jerseyNumber, roster);
          results[guess.candidateIndex] = {
            jerseyNumber: guess.jerseyNumber,
            statType: guess.statType,
            playerId,
          };
          const c = candidates[guess.candidateIndex];
          // localizations[index] may already be set here — localizeCandidate
          // can succeed even when the later tracking/guess step (what
          // actually landed this candidate in the fallback batch) fails.
          // Report that accurately instead of always claiming "no
          // localization," which was misleading for exactly that case.
          const priorLocalization = localizations[guess.candidateIndex];
          const localizationNote = priorLocalization
            ? `localization had ${priorLocalization.method === "vision" ? "succeeded" : priorLocalization.method} before tracking failed`
            : "no localization was attempted";
          console.log(
            `[video-analysis] candidate ${guess.candidateIndex}: ${c.previousScoreText} -> ${c.scoreText}, ` +
              `gap ${c.gapStartSeconds}s-${c.gapEndSeconds}s, wide-frame fallback (${localizationNote}), ` +
              `guessed jersey #${guess.jerseyNumber ?? "?"} -> player ${playerId ?? "unresolved"}, stat ${guess.statType ?? "?"}`
          );
        }
      } catch (err) {
        console.error("guessCandidateStatsBatch failed for a batch:", err);
      }
    }
  }

  return { results, localizations };
}

/**
 * Downloads the linked YouTube video, samples frames at a fixed interval,
 * reads the on-screen scoreboard in each via Claude vision, and stores a
 * candidate row for every detected score change. Runs entirely server-side
 * in the background — the caller does not await this to completion.
 *
 * Requires `ffmpeg` on the host, and (for youtube sources) `yt-dlp`. Not
 * viable on serverless platforms without a persistent worker (no
 * long-running child processes).
 */
export type VideoSource =
  | { type: "youtube"; youtubeVideoId: string }
  | { type: "file"; filePath: string };

export async function runVideoAnalysisJob(jobId: string, source: VideoSource) {
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

    let videoPath: string;
    if (source.type === "file") {
      // Already sitting on disk (direct upload) — no download step needed.
      videoPath = source.filePath;
      await updateJob(jobId, { status: "EXTRACTING", progress: 5 });
    } else {
      await updateJob(jobId, { status: "DOWNLOADING", progress: 5 });

      await run(
        "yt-dlp",
        [
          "-f",
          "worst[ext=mp4][height>=360]/worst[height>=360]/worst",
          "--no-playlist",
          "--extractor-args",
          "youtube:player_client=android,web",
          "--retries",
          "3",
          "--sleep-requests",
          "1",
          "-o",
          path.join(workDir, "video.%(ext)s"),
          `https://www.youtube.com/watch?v=${source.youtubeVideoId}`,
        ],
        YTDLP_TIMEOUT_MS
      );

      const downloadedName = (await readdir(workDir)).find((f) => f.startsWith("video."));
      if (!downloadedName) {
        throw new Error("yt-dlp finished but no video file was found");
      }
      videoPath = path.join(workDir, downloadedName);

      await updateJob(jobId, { status: "EXTRACTING", progress: 15 });
    }

    const framesDir = path.join(workDir, "frames");
    await mkdir(framesDir, { recursive: true });

    await run(
      "ffmpeg",
      ["-i", videoPath, "-vf", `fps=1/${FRAME_INTERVAL_SECONDS}`, "-q:v", "5", path.join(framesDir, "frame_%05d.jpg")],
      FFMPEG_FULL_VIDEO_TIMEOUT_MS
    );

    const frameFiles = (await readdir(framesDir)).filter((f) => f.endsWith(".jpg")).sort();
    if (frameFiles.length === 0) {
      throw new Error("No frames were extracted from the video");
    }

    await updateJob(jobId, { status: "ANALYZING", progress: 20 });

    const allReads: FrameRead[] = [];
    for (let i = 0; i < frameFiles.length; i += FRAMES_PER_VISION_CALL) {
      const batch = frameFiles.slice(i, i + FRAMES_PER_VISION_CALL).map((file, j) => ({
        index: i + j,
        path: path.join(framesDir, file),
        timestampSeconds: (i + j) * FRAME_INTERVAL_SECONDS,
      }));

      const reads = await readScoreboardBatch(batch);
      allReads.push(...reads);

      // ANALYZING (scoreboard reads) covers 20-55; MATCHING (per-candidate
      // tracking, below) gets the much bigger 55-99 share even though it's
      // fewer steps — confirmed in production that tracking (fresh model
      // load + inference per candidate) takes far longer per step than a
      // scoreboard read, so it needs a proportionally larger slice of the
      // bar or the progress bar (and its ETA) looks "almost done" for most
      // of the job's real wall-clock time.
      const pct = 20 + Math.round(((i + batch.length) / frameFiles.length) * 35);
      await updateJob(jobId, { progress: Math.min(pct, 55) });
    }

    const candidateStats: BuildCandidatesStats = { visibleReads: 0, rawChangesDetected: 0, discardedUnconfirmed: 0 };
    const candidates = buildScoreCandidates(allReads, FRAME_INTERVAL_SECONDS, candidateStats);

    let localizationSummary = summarizeLocalizations(0, []);

    if (candidates.length > 0) {
      await updateJob(jobId, { status: "MATCHING", progress: 55 });
      const { results: guesses, localizations } = await guessCandidatePlayers(
        jobId,
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
          // videoTimestampSeconds is the localized timestamp when
          // localization succeeded, otherwise the original gap midpoint —
          // gapStartSeconds/gapEndSeconds are kept alongside it so the
          // original search window is never lost even once localized.
          videoTimestampSeconds: localizations[i]?.localizedTimestampSeconds ?? c.videoTimestampSeconds,
          previousScoreText: c.previousScoreText,
          scoreText: c.scoreText,
          gapStartSeconds: c.gapStartSeconds,
          gapEndSeconds: c.gapEndSeconds,
          localizationConfidence: localizations[i]?.confidence ?? null,
          localizationMethod: localizations[i]?.method ?? null,
          guessedJerseyNumber: guesses[i]?.jerseyNumber ?? null,
          guessedStatType: guesses[i]?.statType ?? null,
          guessedPlayerId: guesses[i]?.playerId ?? null,
        })),
      });

      // Answers "why did the candidate count change" without having to dig
      // through per-candidate log lines — every candidate that's generated
      // here IS what gets shown in the UI (nothing downstream filters the
      // list further), so candidatesGenerated == candidatesShown always.
      // localizationSummary.skipped covers BOTH candidates skipped for an
      // implausible delta AND ones routed to the legacy wide-frame fallback
      // after an earlier tracking failure — attempts + skipped always ==
      // candidates.length, so nothing is silently uncounted.
      localizationSummary = summarizeLocalizations(candidates.length, localizations);

      console.log(
        `[video-analysis] SUMMARY: ${candidateStats.visibleReads} scoreboard-visible reads, ` +
          `${candidateStats.rawChangesDetected} raw score changes detected, ` +
          `${candidateStats.discardedUnconfirmed} discarded as unconfirmed (likely misreads), ` +
          `${candidates.length} candidates generated (= shown in UI), ` +
          `localization: ${localizationSummary.attempts} attempted, ${localizationSummary.skipped} skipped ` +
          `(implausible delta or legacy fallback), ${localizationSummary.success} succeeded, ` +
          `${localizationSummary.fallbackNoEvidence} fell back (no evidence), ` +
          `${localizationSummary.fallbackError} failed (error)`
      );
    } else {
      console.log(
        `[video-analysis] SUMMARY: ${candidateStats.visibleReads} scoreboard-visible reads, ` +
          `${candidateStats.rawChangesDetected} raw score changes detected, ` +
          `${candidateStats.discardedUnconfirmed} discarded as unconfirmed (likely misreads), ` +
          `0 candidates generated`
      );
    }

    // Internal QA record — see AnalysisSummary in schema.prisma. Best-effort:
    // a failure here shouldn't fail the whole analysis job, since the coach-
    // facing candidates are already saved by this point.
    try {
      await prisma.analysisSummary.create({
        data: {
          jobId,
          matchId: job.matchId,
          gitCommitHash: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
          scoreChangesDetected: candidateStats.rawChangesDetected,
          suggestedMomentsGenerated: candidates.length,
          localizationAttempts: localizationSummary.attempts,
          localizationSuccess: localizationSummary.success,
          localizationFallback: localizationSummary.fallbackNoEvidence,
          localizationFailed: localizationSummary.fallbackError,
          averageLocalizationConfidence: localizationSummary.averageAttemptConfidence,
          totalProcessingSeconds: (Date.now() - job.createdAt.getTime()) / 1000,
        },
      });
    } catch (err) {
      console.error("Failed to record AnalysisSummary:", err);
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
