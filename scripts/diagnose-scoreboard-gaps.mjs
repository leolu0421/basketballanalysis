#!/usr/bin/env node
/**
 * diagnose-scoreboard-gaps.mjs
 * ============================
 *
 * Standalone diagnostic tool for investigating specific scoreboard-reading
 * gaps found in a video-analysis job (see the "Localized: 1" AnalysisSummary
 * investigation). It re-reads a handful of hand-picked gap windows from a
 * source video at a finer sampling rate than the production pipeline uses,
 * so a human can see what Claude vision actually reports frame-by-frame
 * through a stretch the production pipeline collapsed into one candidate
 * (or merged/miscounted).
 *
 * SAFETY / SCOPE — READ BEFORE RUNNING
 * -------------------------------------
 * - This script is NEVER imported by application code. It has no import
 *   path from src/. It is invoked manually, from the command line, only.
 * - It never touches the database. No `prisma` import, no DB client of any
 *   kind. It cannot write, update, or delete anything in Postgres.
 * - It never creates Suggested Moments, never modifies match data, never
 *   writes to any table the app reads from. Its only outputs are local
 *   files under --output-dir (JSON, CSV, JPEG crops).
 * - It never logs or persists the Anthropic API key. Only whether the env
 *   var is present is checked/printed — never its value or any prefix of it
 *   (stricter than src/lib/video-analysis/vision.ts's describeApiKey, which
 *   prints a key prefix — deliberately not reused here).
 *
 * MODEL — kept in sync with production, not duplicated
 * ------------------------------------------------------
 * Rather than hard-coding a model id here (which would silently drift from
 * production the next time someone changes CLAUDE_MODEL in vision.ts), this
 * script reads src/lib/video-analysis/vision.ts's source at startup and
 * extracts the same `const CLAUDE_MODEL = "..."` it uses. This is read-only
 * — it does not import or execute vision.ts, and it makes no edit to any
 * production file. If that constant is ever renamed, this script fails
 * loudly (see resolveProductionModel()) rather than silently falling back
 * to a wrong/hard-coded model.
 *
 * VIDEO SOURCE
 * ------------
 * Exactly one of --youtube-id / --video-path / --video-url is required.
 * IMPORTANT: if you run this via `railway run ...`, that executes the
 * command LOCALLY (wherever you type `railway run`) with Railway's
 * environment variables injected — it does NOT run inside the actual
 * Railway container and does NOT mount the production Railway Volume. A
 * --video-path pointing at a Volume-only path (e.g. /data/videos/...) will
 * not resolve under `railway run` unless that path also exists locally.
 * Use --youtube-id or --video-url for anything that isn't on your own
 * machine, or run this from inside the actual deployed container (e.g. via
 * Railway's web Shell) if you specifically need the Volume's contents.
 *
 * USAGE — see the bottom of this file / the project chat for exact
 * copy-pasteable commands (verify-crop, youtube pilot, video-path pilot,
 * locating output).
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, access, stat } from "node:fs/promises";
import { pipeline as streamPipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const VISION_TS_PATH = path.join(PROJECT_ROOT, "src", "lib", "video-analysis", "vision.ts");

// ---------------------------------------------------------------------------
// The 3 gap windows selected for this pilot (see prior chat report). Kept as
// a fixed list rather than a CLI arg — these are the specific, already-
// investigated gaps this diagnostic pass is about; --gaps=A,B,C lets you run
// a subset of them, not arbitrary new ones.
// ---------------------------------------------------------------------------
const GAPS = [
  {
    id: "A",
    label: "score-decrease",
    previousScoreText: "16-19",
    scoreText: "6-9",
    startSeconds: 390,
    endSeconds: 450,
  },
  {
    id: "B",
    label: "short-both-sides-changed",
    previousScoreText: "35-35",
    scoreText: "38-36",
    startSeconds: 1815,
    endSeconds: 1875,
  },
  {
    id: "C",
    label: "long-merged-score",
    previousScoreText: "19-18",
    scoreText: "26-28",
    startSeconds: 945,
    endSeconds: 1440,
  },
];

const UNIFORM_SAMPLE_INTERVAL_SECONDS = 2; // gaps A and B
const COARSE_SAMPLE_INTERVAL_SECONDS = 5; // gap C, pass 1
const DENSE_SAMPLE_INTERVAL_SECONDS = 2; // gap C, pass 2 (hot windows only)
// How far to pad a detected hot window on each side before dense-resampling
// it — a real transition can lag the coarse read that first shows it, same
// reasoning as the production pipeline's localization padding
// (LOCALIZED_CLIP_BEFORE/AFTER_SECONDS in pipeline.ts). Defaults to one
// coarse step.
const HOT_WINDOW_PAD_SECONDS = COARSE_SAMPLE_INTERVAL_SECONDS;

const DEFAULT_BATCH_SIZE = 5;
const FFMPEG_TIMEOUT_MS = 3 * 60 * 1000;
const YTDLP_TIMEOUT_MS = 15 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

// Confirmed pricing for claude-opus-4-8 (USD per million tokens). Keyed by
// model id so a mismatch between this table and whatever
// resolveProductionModel() actually finds in vision.ts fails loudly instead
// of silently costing the estimate against the wrong price.
const PRICING_TABLE = {
  "claude-opus-4-8": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { batchSize: DEFAULT_BATCH_SIZE, gaps: GAPS.map((g) => g.id) };
  for (const raw of argv) {
    if (raw === "--verify-crop") {
      args.verifyCrop = true;
    } else if (raw === "--plan-only") {
      args.planOnly = true;
    } else if (raw.startsWith("--youtube-id=")) {
      args.youtubeId = raw.slice("--youtube-id=".length);
    } else if (raw.startsWith("--video-path=")) {
      args.videoPath = raw.slice("--video-path=".length);
    } else if (raw.startsWith("--video-url=")) {
      args.videoUrl = raw.slice("--video-url=".length);
    } else if (raw.startsWith("--crop=")) {
      args.crop = raw.slice("--crop=".length);
    } else if (raw.startsWith("--batch-size=")) {
      args.batchSize = Number.parseInt(raw.slice("--batch-size=".length), 10);
    } else if (raw.startsWith("--output-dir=")) {
      args.outputDir = raw.slice("--output-dir=".length);
    } else if (raw.startsWith("--gaps=")) {
      args.gaps = raw
        .slice("--gaps=".length)
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (raw === "--help" || raw === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unrecognized argument: ${raw}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
diagnose-scoreboard-gaps.mjs — standalone scoreboard-read diagnostic (no DB writes, never imported by the app)

Video source (exactly one required, except with --plan-only):
  --youtube-id=<ID>              Download via yt-dlp, same as production.
  --video-path=<PATH>            Use a local/mounted file directly.
  --video-url=<URL>               Download from a signed or public URL.

Crop (required, except with --plan-only):
  --crop=x:y:width:height        Scoreboard crop rectangle, in source pixels.

Other flags:
  --verify-crop                  Save one sample crop per gap, print paths, exit.
                                  (Always happens first anyway — this just stops there.)
  --plan-only                    Print expected frame/request counts and exit.
                                  No video, no crop, no network, no API calls.
  --batch-size=<N>                Frames per Claude request (default ${DEFAULT_BATCH_SIZE}).
  --gaps=A,B,C                    Subset of gaps to run (default: all three).
  --output-dir=<PATH>             Where to write output (default: scripts/diagnostics-output/<timestamp>/).
  --help                          This message.
`);
}

// ---------------------------------------------------------------------------
// Model resolution — read-only extraction from vision.ts, see file header.
// ---------------------------------------------------------------------------
async function resolveProductionModel() {
  const source = await readFile(VISION_TS_PATH, "utf-8");
  const match = source.match(/const\s+CLAUDE_MODEL\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(
      `Could not find "const CLAUDE_MODEL = ..." in ${VISION_TS_PATH}. ` +
        `Refusing to guess a model — update this script's extraction regex ` +
        `if that constant was renamed/restructured.`
    );
  }
  const model = match[1];
  if (!PRICING_TABLE[model]) {
    throw new Error(
      `Production model is "${model}" but PRICING_TABLE in this script has no ` +
        `entry for it. Refusing to estimate cost against the wrong price — add ` +
        `a PRICING_TABLE["${model}"] entry (input/output $ per MTok) before running.`
    );
  }
  return model;
}

// ---------------------------------------------------------------------------
// Process helpers (mirrors pipeline.ts's run()/runCapture() conventions —
// standalone copies, not shared code, so this script has zero import edge
// from src/).
// ---------------------------------------------------------------------------
function run(cmd, args, timeoutMs) {
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

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Video source resolution
// ---------------------------------------------------------------------------
async function resolveVideoSource(args, workDir) {
  const provided = ["youtubeId", "videoPath", "videoUrl"].filter((k) => args[k]);
  if (provided.length !== 1) {
    throw new Error(
      `Exactly one of --youtube-id / --video-path / --video-url is required (got ${provided.length}: ${provided.join(", ") || "none"}).`
    );
  }

  if (args.videoPath) {
    if (!(await pathExists(args.videoPath))) {
      throw new Error(
        `--video-path "${args.videoPath}" does not exist here. Reminder: if you're running this via ` +
          `"railway run", that executes LOCALLY with Railway's env vars injected — it does NOT mount the ` +
          `production Railway Volume. A Volume-only path won't resolve unless you're running inside the ` +
          `actual deployed container (e.g. via Railway's web Shell).`
      );
    }
    const st = await stat(args.videoPath);
    if (!st.isFile()) throw new Error(`--video-path "${args.videoPath}" is not a file.`);
    console.log(`[video-source] Using local file: ${args.videoPath}`);
    return args.videoPath;
  }

  if (args.youtubeId) {
    console.log(`[video-source] Downloading via yt-dlp: youtube-id=${args.youtubeId}`);
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
        path.join(workDir, "source.%(ext)s"),
        `https://www.youtube.com/watch?v=${args.youtubeId}`,
      ],
      YTDLP_TIMEOUT_MS
    );
    const downloaded = (await readdir(workDir)).find((f) => f.startsWith("source."));
    if (!downloaded) throw new Error("yt-dlp finished but no video file was found");
    const videoPath = path.join(workDir, downloaded);
    console.log(`[video-source] Downloaded to: ${videoPath}`);
    return videoPath;
  }

  // args.videoUrl
  console.log(`[video-source] Downloading from URL (host: ${safeUrlHost(args.videoUrl)})`);
  const dest = path.join(workDir, "source.mp4");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(args.videoUrl, { signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download --video-url: HTTP ${res.status}`);
    }
    await streamPipeline(res.body, createWriteStream(dest));
  } finally {
    clearTimeout(timer);
  }
  console.log(`[video-source] Downloaded to: ${dest}`);
  return dest;
}

/** Used only in a log line — never prints query strings/tokens from a signed URL. */
function safeUrlHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable URL)";
  }
}

function parseCrop(cropArg) {
  if (!cropArg) {
    throw new Error(
      `--crop=x:y:width:height is required. Pick a rough guess for the scoreboard banner's pixel ` +
        `rectangle in the source video, then run with --verify-crop and look at the saved sample ` +
        `images before spending any API credits.`
    );
  }
  const parts = cropArg.split(":").map((s) => Number.parseInt(s, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0)) {
    throw new Error(`--crop must be "x:y:width:height" with 4 non-negative integers, got "${cropArg}"`);
  }
  const [x, y, width, height] = parts;
  if (width === 0 || height === 0) throw new Error(`--crop width/height must be > 0, got "${cropArg}"`);
  return { x, y, width, height };
}

function cropFilter(crop) {
  // ffmpeg's crop filter is out_w:out_h:x:y — different order from our
  // --crop=x:y:width:height CLI convention, so this is the one place that
  // reorders it.
  return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`;
}

// ---------------------------------------------------------------------------
// Frame extraction
// ---------------------------------------------------------------------------
async function extractCropSample(videoPath, crop, gap, outDir) {
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${gap.id}-sample.jpg`);
  const sampleAt = gap.startSeconds + Math.min(2, (gap.endSeconds - gap.startSeconds) / 2);
  await run(
    "ffmpeg",
    ["-y", "-ss", String(sampleAt), "-i", videoPath, "-vframes", "1", "-vf", cropFilter(crop), "-q:v", "2", outPath],
    FFMPEG_TIMEOUT_MS
  );
  return outPath;
}

/**
 * Extracts frames at `intervalSeconds` from [start, start+duration), cropped
 * to the scoreboard rectangle, into their own subfolder. Returns the frames
 * with their real (absolute) video timestamps.
 */
async function extractFrames(videoPath, crop, start, duration, intervalSeconds, outDir) {
  await mkdir(outDir, { recursive: true });
  await run(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(start),
      "-i",
      videoPath,
      "-t",
      String(Math.max(0.1, duration)),
      "-vf",
      `${cropFilter(crop)},fps=1/${intervalSeconds}`,
      "-q:v",
      "3",
      path.join(outDir, "frame_%05d.jpg"),
    ],
    FFMPEG_TIMEOUT_MS
  );
  const files = (await readdir(outDir)).filter((f) => f.endsWith(".jpg")).sort();
  return files.map((file, i) => ({
    path: path.join(outDir, file),
    timestampSeconds: start + i * intervalSeconds,
  }));
}

// ---------------------------------------------------------------------------
// Claude vision call
// ---------------------------------------------------------------------------
const FrameScoreReadSchema = z.object({
  frameIndex: z.number().int(),
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  ambiguityReason: z.string().nullable(),
});
const BatchReadSchema = z.object({ reads: z.array(FrameScoreReadSchema) });

let anthropicClient = null;
function getClient() {
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

/**
 * Sends one batch of cropped scoreboard frames to Claude and asks for a
 * structured per-frame score read with a confidence and an ambiguity
 * reason. Returns the parsed reads plus the actual usage the API reported.
 */
async function sendBatch(model, frames) {
  const anthropic = getClient();
  const content = [
    {
      type: "text",
      text:
        `Each image below is a cropped scoreboard-overlay region from a basketball game video, shown in ` +
        `chronological order. For each frame, read the home and away scores exactly as displayed. If a ` +
        `digit is unclear, occluded, or the overlay is missing/blank in that frame, still report your best ` +
        `guess for homeScore/awayScore if you can make one, set confidence low, and explain why in ` +
        `ambiguityReason (e.g. "digit partially occluded", "overlay not visible", "motion blur"). If you ` +
        `truly cannot read anything, set homeScore and awayScore to null. Report exactly one entry per ` +
        `frameIndex given.`,
    },
  ];
  for (const frame of frames) {
    content.push({ type: "text", text: `frameIndex=${frame.frameIndex} (t=${frame.timestampSeconds}s):` });
    const data = (await readFile(frame.path)).toString("base64");
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  }

  const response = await anthropic.messages.parse({
    model,
    max_tokens: 2048,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(BatchReadSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Vision analysis did not return a valid structured response");
  }

  return {
    reads: response.parsed_output.reads,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

/** Retries a batch once on failure, records (but does not throw) a second failure. */
async function sendBatchWithRetry(model, gapId, phase, batchNumber, frames, failures) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await sendBatch(model, frames);
    } catch (err) {
      const message = err instanceof APIError ? `HTTP ${err.status} ${err.type}: ${err.message}` : String(err?.message ?? err);
      console.error(
        `[batch-failed] gap=${gapId} phase=${phase} batch=${batchNumber} attempt=${attempt}/2: ${message}`
      );
      if (attempt === 2) {
        failures.push({ gapId, phase, batchNumber, frameCount: frames.length, error: message });
        return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Batching (never mixes frames from different gaps; batch size configurable)
// ---------------------------------------------------------------------------
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Adaptive plan preview (pure arithmetic — no video, no network, no API key
// needed). Used both by --plan-only and by the "show expected counts" step
// requested after writing this script.
// ---------------------------------------------------------------------------
function planUniformGap(gap, batchSize) {
  const duration = gap.endSeconds - gap.startSeconds;
  const frames = Math.floor(duration / UNIFORM_SAMPLE_INTERVAL_SECONDS);
  const batches = Math.ceil(frames / batchSize);
  return { frames, batches };
}

function planGapC(gap, batchSize, illustrativeHotWindows) {
  const duration = gap.endSeconds - gap.startSeconds;
  const coarseFrames = Math.floor(duration / COARSE_SAMPLE_INTERVAL_SECONDS);
  const coarseBatches = Math.ceil(coarseFrames / batchSize);

  // Each isolated (non-adjacent-merged) hot window is one coarse interval
  // (COARSE_SAMPLE_INTERVAL_SECONDS wide) padded by HOT_WINDOW_PAD_SECONDS on
  // both sides, then dense-resampled at DENSE_SAMPLE_INTERVAL_SECONDS.
  const isolatedWindowSeconds = COARSE_SAMPLE_INTERVAL_SECONDS + 2 * HOT_WINDOW_PAD_SECONDS;
  const denseFramesPerWindow = Math.floor(isolatedWindowSeconds / DENSE_SAMPLE_INTERVAL_SECONDS);

  const bestCase = { hotWindows: 0, denseFrames: 0, denseBatches: 0 };
  const illustrative = {
    hotWindows: illustrativeHotWindows,
    denseFrames: illustrativeHotWindows * denseFramesPerWindow,
    denseBatches: Math.ceil((illustrativeHotWindows * denseFramesPerWindow) / batchSize),
  };
  // Pathological upper bound: coarse pass flags (almost) every interval as
  // hot, so dense resampling approaches blanket 2s coverage of the whole
  // gap — exactly what adaptive sampling exists to avoid in the common case.
  const worstCaseDenseFrames = Math.floor(duration / DENSE_SAMPLE_INTERVAL_SECONDS);
  const worstCase = {
    hotWindows: Math.ceil(duration / COARSE_SAMPLE_INTERVAL_SECONDS),
    denseFrames: worstCaseDenseFrames,
    denseBatches: Math.ceil(worstCaseDenseFrames / batchSize),
  };

  return { coarseFrames, coarseBatches, denseFramesPerWindow, bestCase, illustrative, worstCase };
}

function printPlan(batchSize) {
  console.log(`\n=== Adaptive sampling plan (batch size ${batchSize}) ===\n`);

  let totalFramesBest = 0;
  let totalBatchesBest = 0;
  let totalFramesIllustrative = 0;
  let totalBatchesIllustrative = 0;

  for (const gap of GAPS) {
    if (gap.id === "C") continue;
    const p = planUniformGap(gap, batchSize);
    console.log(
      `Gap ${gap.id} (${gap.label}, ${gap.endSeconds - gap.startSeconds}s, uniform ${UNIFORM_SAMPLE_INTERVAL_SECONDS}s sampling): ` +
        `${p.frames} frames, ${p.batches} batches/requests`
    );
    totalFramesBest += p.frames;
    totalBatchesBest += p.batches;
    totalFramesIllustrative += p.frames;
    totalBatchesIllustrative += p.batches;
  }

  const gapC = GAPS.find((g) => g.id === "C");
  const illustrativeHotWindows = 4; // clearly-labeled illustrative guess, see chat report
  const c = planGapC(gapC, batchSize, illustrativeHotWindows);
  console.log(
    `\nGap C (${gapC.label}, ${gapC.endSeconds - gapC.startSeconds}s) — adaptive:\n` +
      `  Pass 1 (coarse, ${COARSE_SAMPLE_INTERVAL_SECONDS}s sampling): ${c.coarseFrames} frames, ${c.coarseBatches} batches/requests — FIXED, always runs.\n` +
      `  Pass 2 (dense, ${DENSE_SAMPLE_INTERVAL_SECONDS}s sampling of hot windows only) — DATA-DEPENDENT, only known after pass 1 actually runs:\n` +
      `    best case (0 hot windows found):        +${c.bestCase.denseFrames} frames, +${c.bestCase.denseBatches} batches\n` +
      `    illustrative (${illustrativeHotWindows} isolated hot windows): +${c.illustrative.denseFrames} frames, +${c.illustrative.denseBatches} batches\n` +
      `    pathological worst case (all flagged):  +${c.worstCase.denseFrames} frames, +${c.worstCase.denseBatches} batches (approaches blanket 2s coverage)`
  );

  totalFramesBest += c.coarseFrames + c.bestCase.denseFrames;
  totalBatchesBest += c.coarseBatches + c.bestCase.denseBatches;
  totalFramesIllustrative += c.coarseFrames + c.illustrative.denseFrames;
  totalBatchesIllustrative += c.coarseBatches + c.illustrative.denseBatches;

  console.log(
    `\nTotals across all 3 gaps:\n` +
      `  Guaranteed minimum (gap C finds 0 transitions): ${totalFramesBest} frames, ${totalBatchesBest} requests\n` +
      `  Illustrative (gap C finds ${illustrativeHotWindows} isolated transitions): ${totalFramesIllustrative} frames, ${totalBatchesIllustrative} requests\n` +
      `  These are NOT guarantees for pass 2 — the actual count depends entirely on what the coarse pass reads, by design.\n`
  );
}

// ---------------------------------------------------------------------------
// CSV / JSON output helpers
// ---------------------------------------------------------------------------
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADER = [
  "gapId",
  "timestampSeconds",
  "homeScore",
  "awayScore",
  "confidence",
  "ambiguityReason",
  "rawModelOutput",
  "batchNumber",
  "model",
].join(",");

function csvRow(row) {
  return [
    row.gapId,
    row.timestampSeconds,
    row.homeScore,
    row.awayScore,
    row.confidence,
    row.ambiguityReason,
    row.rawModelOutput,
    row.batchNumber,
    row.model,
  ]
    .map(csvEscape)
    .join(",");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.planOnly) {
    printPlan(args.batchSize);
    return;
  }

  if (!Number.isInteger(args.batchSize) || args.batchSize < 1) {
    throw new Error(`--batch-size must be a positive integer, got "${args.batchSize}"`);
  }

  const selectedGaps = GAPS.filter((g) => args.gaps.includes(g.id));
  if (selectedGaps.length === 0) {
    throw new Error(`--gaps matched none of A,B,C (got "${args.gaps.join(",")}")`);
  }

  const crop = parseCrop(args.crop);

  const outputDir = args.outputDir ?? path.join(PROJECT_ROOT, "scripts", "diagnostics-output", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outputDir, { recursive: true });
  const framesRootDir = path.join(outputDir, "frames");
  const cropVerifyDir = path.join(outputDir, "crop-verify");

  console.log(`[setup] Output directory: ${outputDir}`);
  console.log(
    `[setup] ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "set" : "MISSING"} (never logging its value)`
  );

  const model = await resolveProductionModel();
  console.log(`[setup] Using production model (read from vision.ts): ${model}`);

  const workDir = path.join(outputDir, "source-video");
  await mkdir(workDir, { recursive: true });
  const videoPath = await resolveVideoSource(args, workDir);

  // --- Crop verification: always runs first, before anything is sent to Claude. ---
  console.log(`\n[crop-verify] Extracting one sample crop per selected gap...`);
  const sampleCropPaths = [];
  for (const gap of selectedGaps) {
    const p = await extractCropSample(videoPath, crop, gap, cropVerifyDir);
    sampleCropPaths.push(p);
    console.log(`[crop-verify] Gap ${gap.id}: ${p}`);
  }

  if (args.verifyCrop) {
    console.log(
      `\n[crop-verify] Stopping here (--verify-crop). Open the ${sampleCropPaths.length} image(s) above and ` +
        `confirm the crop fully contains the scoreboard before running without --verify-crop.`
    );
    return;
  }

  // --- Full pilot run ---
  const startedAt = Date.now();
  let framesExtracted = 0;
  let framesSent = 0;
  let apiRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const failures = [];
  const timelineRows = [];
  const perGapSummary = {};
  let globalBatchNumber = 0;

  for (const gap of selectedGaps) {
    console.log(`\n[gap ${gap.id}] ${gap.label}: ${gap.previousScoreText} -> ${gap.scoreText}, ${gap.startSeconds}s-${gap.endSeconds}s`);
    const gapFramesDir = path.join(framesRootDir, gap.id);
    let gapFramesExtracted = 0;
    let gapFramesSent = 0;
    let gapRequests = 0;
    let gapInputTokens = 0;
    let gapOutputTokens = 0;
    let hotWindowsFound;

    let framesToSend = [];

    if (gap.id !== "C") {
      const duration = gap.endSeconds - gap.startSeconds;
      const uniform = await extractFrames(
        videoPath,
        crop,
        gap.startSeconds,
        duration,
        UNIFORM_SAMPLE_INTERVAL_SECONDS,
        path.join(gapFramesDir, "uniform")
      );
      gapFramesExtracted += uniform.length;
      framesToSend = uniform.map((f, i) => ({ ...f, frameIndex: i }));
    } else {
      // Pass 1: coarse.
      const duration = gap.endSeconds - gap.startSeconds;
      const coarse = await extractFrames(
        videoPath,
        crop,
        gap.startSeconds,
        duration,
        COARSE_SAMPLE_INTERVAL_SECONDS,
        path.join(gapFramesDir, "coarse")
      );
      gapFramesExtracted += coarse.length;
      console.log(`[gap C] Coarse pass: ${coarse.length} frames at ${COARSE_SAMPLE_INTERVAL_SECONDS}s intervals`);

      const coarseReads = [];
      const coarseBatches = chunk(
        coarse.map((f, i) => ({ ...f, frameIndex: i })),
        args.batchSize
      );
      for (const batch of coarseBatches) {
        globalBatchNumber++;
        gapRequests++;
        apiRequests++;
        gapFramesSent += batch.length;
        framesSent += batch.length;
        const result = await sendBatchWithRetry(model, gap.id, "coarse", globalBatchNumber, batch, failures);
        if (result) {
          gapInputTokens += result.inputTokens;
          gapOutputTokens += result.outputTokens;
          totalInputTokens += result.inputTokens;
          totalOutputTokens += result.outputTokens;
        }
        recordBatchResults(timelineRows, gap.id, "coarse", globalBatchNumber, model, batch, result);
        if (result) coarseReads.push(...result.reads.map((r, i) => ({ ...r, timestampSeconds: batch[i]?.timestampSeconds })));
      }

      // Detect hot 5s intervals: flag as hot if either score changed between
      // consecutive coarse reads, OR either read is unreadable (null) — an
      // unreadable read could be hiding a real transition, so this
      // deliberately over-flags rather than risk silently skipping one.
      const rawHotIntervals = [];
      for (let i = 0; i < coarseReads.length - 1; i++) {
        const a = coarseReads[i];
        const b = coarseReads[i + 1];
        const unreadable = a.homeScore === null || a.awayScore === null || b.homeScore === null || b.awayScore === null;
        const changed = a.homeScore !== b.homeScore || a.awayScore !== b.awayScore;
        if (unreadable || changed) {
          rawHotIntervals.push([a.timestampSeconds, b.timestampSeconds]);
        }
      }

      const paddedIntervals = rawHotIntervals.map(([s, e]) => [
        Math.max(gap.startSeconds, s - HOT_WINDOW_PAD_SECONDS),
        Math.min(gap.endSeconds, e + HOT_WINDOW_PAD_SECONDS),
      ]);
      const mergedIntervals = mergeIntervals(paddedIntervals);
      hotWindowsFound = mergedIntervals.length;
      console.log(
        `[gap C] Hot windows found: ${hotWindowsFound} (from ${rawHotIntervals.length} raw coarse-interval flags, padded ±${HOT_WINDOW_PAD_SECONDS}s and merged)`
      );

      // Pass 2: dense resample of hot windows only.
      let denseFrameIndex = 0;
      const denseAll = [];
      for (let wi = 0; wi < mergedIntervals.length; wi++) {
        const [s, e] = mergedIntervals[wi];
        const dense = await extractFrames(
          videoPath,
          crop,
          s,
          e - s,
          DENSE_SAMPLE_INTERVAL_SECONDS,
          path.join(gapFramesDir, `dense-window-${wi}`)
        );
        gapFramesExtracted += dense.length;
        for (const f of dense) denseAll.push({ ...f, frameIndex: denseFrameIndex++ });
      }
      console.log(`[gap C] Dense pass: ${denseAll.length} frames across ${mergedIntervals.length} hot window(s)`);

      const denseBatches = chunk(denseAll, args.batchSize);
      for (const batch of denseBatches) {
        globalBatchNumber++;
        gapRequests++;
        apiRequests++;
        gapFramesSent += batch.length;
        framesSent += batch.length;
        const result = await sendBatchWithRetry(model, gap.id, "dense", globalBatchNumber, batch, failures);
        if (result) {
          gapInputTokens += result.inputTokens;
          gapOutputTokens += result.outputTokens;
          totalInputTokens += result.inputTokens;
          totalOutputTokens += result.outputTokens;
        }
        recordBatchResults(timelineRows, gap.id, "dense", globalBatchNumber, model, batch, result);
      }

      framesExtracted += gapFramesExtracted;
      perGapSummary[gap.id] = {
        label: gap.label,
        framesExtracted: gapFramesExtracted,
        framesSent: gapFramesSent,
        apiRequests: gapRequests,
        inputTokens: gapInputTokens,
        outputTokens: gapOutputTokens,
        hotWindowsFound,
      };
      continue; // gap C handled fully above, skip the shared uniform-gap block below
    }

    // Shared path for uniform gaps (A, B).
    framesExtracted += gapFramesExtracted;
    const batches = chunk(framesToSend, args.batchSize);
    for (const batch of batches) {
      globalBatchNumber++;
      gapRequests++;
      apiRequests++;
      gapFramesSent += batch.length;
      framesSent += batch.length;
      const result = await sendBatchWithRetry(model, gap.id, "uniform", globalBatchNumber, batch, failures);
      if (result) {
        gapInputTokens += result.inputTokens;
        gapOutputTokens += result.outputTokens;
        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;
      }
      recordBatchResults(timelineRows, gap.id, "uniform", globalBatchNumber, model, batch, result);
    }

    perGapSummary[gap.id] = {
      label: gap.label,
      framesExtracted: gapFramesExtracted,
      framesSent: gapFramesSent,
      apiRequests: gapRequests,
      inputTokens: gapInputTokens,
      outputTokens: gapOutputTokens,
    };
  }

  const processingMs = Date.now() - startedAt;
  const pricing = PRICING_TABLE[model];
  const estimatedCostUsd =
    (totalInputTokens / 1_000_000) * pricing.inputPerMTok + (totalOutputTokens / 1_000_000) * pricing.outputPerMTok;

  // --- Write outputs ---
  const csvPath = path.join(outputDir, "scoreboard-timeline.csv");
  const csvBody = [CSV_HEADER, ...timelineRows.map(csvRow)].join("\n");
  await writeFileSafe(csvPath, csvBody);

  const summary = {
    generatedAt: new Date().toISOString(),
    model,
    crop,
    batchSize: args.batchSize,
    videoSource: describeSource(args),
    gaps: perGapSummary,
    totals: {
      framesExtracted,
      framesSent,
      apiRequests,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      processingMs,
      estimatedCostUsd, // ESTIMATED — see pricing note below
    },
    pricingUsedUsdPerMTok: pricing,
    costEstimateNote:
      "estimatedCostUsd is ESTIMATED from actual reported token usage x the PRICING_TABLE rates hard-coded " +
      "in this script — confirm against your Anthropic dashboard for the real charge.",
    failures,
    outputPaths: { csv: csvPath, framesDir: framesRootDir, cropVerifyDir },
  };
  const summaryPath = path.join(outputDir, "diagnostic-summary.json");
  await writeFileSafe(summaryPath, JSON.stringify(summary, null, 2));

  // --- Final report ---
  console.log(`\n=== Run complete ===`);
  console.log(`Frames extracted:     ${framesExtracted}`);
  console.log(`Frames sent to Claude: ${framesSent}`);
  console.log(`API requests:          ${apiRequests}`);
  console.log(`Actual input tokens:   ${totalInputTokens}`);
  console.log(`Actual output tokens:  ${totalOutputTokens}`);
  console.log(`Actual processing time: ${(processingMs / 1000).toFixed(1)}s`);
  console.log(`Estimated cost (USD, from actual usage x configured pricing): $${estimatedCostUsd.toFixed(4)} — ESTIMATED, confirm on the Anthropic dashboard.`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} batch(es) failed after retry — see diagnostic-summary.json's "failures".`);
  }
  console.log(`\nOutputs:\n  ${summaryPath}\n  ${csvPath}\n  ${framesRootDir}/\n`);
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0]];
  for (const [s, e] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

function recordBatchResults(timelineRows, gapId, phase, batchNumber, model, batch, result) {
  if (result) {
    for (let i = 0; i < batch.length; i++) {
      const frame = batch[i];
      const read = result.reads.find((r) => r.frameIndex === frame.frameIndex);
      timelineRows.push({
        gapId: `${gapId}${phase !== "uniform" ? `/${phase}` : ""}`,
        timestampSeconds: frame.timestampSeconds,
        homeScore: read?.homeScore ?? "",
        awayScore: read?.awayScore ?? "",
        confidence: read?.confidence ?? "",
        ambiguityReason: read?.ambiguityReason ?? (read ? "" : "no matching read returned for this frameIndex"),
        rawModelOutput: read ? JSON.stringify(read) : "",
        batchNumber,
        model,
      });
    }
  } else {
    // Batch failed twice — still record one row per frame so the CSV covers
    // every frame that was sent, not just successes.
    for (const frame of batch) {
      timelineRows.push({
        gapId: `${gapId}${phase !== "uniform" ? `/${phase}` : ""}`,
        timestampSeconds: frame.timestampSeconds,
        homeScore: "",
        awayScore: "",
        confidence: "",
        ambiguityReason: "batch failed after retry — see diagnostic-summary.json's failures",
        rawModelOutput: "",
        batchNumber,
        model,
      });
    }
  }
}

function describeSource(args) {
  if (args.youtubeId) return { type: "youtube", youtubeId: args.youtubeId };
  if (args.videoPath) return { type: "video-path", videoPath: args.videoPath };
  if (args.videoUrl) return { type: "video-url", host: safeUrlHost(args.videoUrl) }; // never store the full (possibly signed) URL
  return { type: "unknown" };
}

async function writeFileSafe(filePath, content) {
  const { writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

main().catch((err) => {
  console.error(`\n[fatal] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
