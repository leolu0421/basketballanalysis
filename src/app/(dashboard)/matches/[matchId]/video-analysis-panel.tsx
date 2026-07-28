"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  startVideoAnalysisAction,
  getVideoAnalysisStatus,
  dismissCandidateAction,
  confirmCandidateAction,
} from "@/lib/actions/video-analysis-actions";
import { STAT_LABELS, type StatType } from "@/lib/stat-types";

const MADE_TYPES: StatType[] = ["FG2_MADE", "FG3_MADE", "FT_MADE"];

type Player = { id: string; firstName: string; lastName: string; jerseyNumber: string };

type Candidate = {
  id: string;
  videoTimestampSeconds: number;
  previousScoreText: string | null;
  scoreText: string | null;
  guessedJerseyNumber: string | null;
  guessedStatType: string | null;
  guessedPlayerId: string | null;
};

type Job = {
  id: string;
  status: string;
  progress: number;
  errorMessage: string | null;
  createdAt: string | Date;
  candidates: Candidate[];
} | null;

const ACTIVE_STATUSES = ["PENDING", "DOWNLOADING", "EXTRACTING", "ANALYZING", "MATCHING"];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Queued…",
  DOWNLOADING: "Downloading video…",
  EXTRACTING: "Extracting frames…",
  ANALYZING: "Reading scoreboard…",
  MATCHING: "Guessing players…",
  DONE: "Done",
  FAILED: "Failed",
};

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Rough estimate only. The pipeline's phases (frame extraction, scoreboard
 * reads, per-candidate tracking) advance at very different rates — tracking
 * in particular is much slower per step than a scoreboard read — so a
 * simple elapsed-time/progress average since job start (the original
 * approach) badly overestimates speed once a slow phase is reached, showing
 * "less than a minute left" for many real minutes. Using only the recent
 * window's rate adapts to whichever phase is currently running.
 */
const MIN_PROGRESS_FOR_ESTIMATE = 8;
const SAMPLE_WINDOW_MS = 90_000;
const MIN_SAMPLE_SPAN_MS = 8_000;

type ProgressSample = { progress: number; time: number };

function estimateRemainingLabel(
  samples: ProgressSample[],
  progress: number,
  now: number
): string | null {
  if (progress < MIN_PROGRESS_FOR_ESTIMATE || progress >= 100) return null;
  if (samples.length < 2) return null;

  const oldest = samples[0];
  const spanMs = now - oldest.time;
  if (spanMs < MIN_SAMPLE_SPAN_MS) return null;

  const progressDelta = progress - oldest.progress;
  if (progressDelta <= 0) return "still working (progress has slowed)";

  const rate = progressDelta / spanMs;
  const remainingMs = (100 - progress) / rate;

  if (remainingMs < 60_000) return "less than a minute left (estimate)";
  const minutes = Math.round(remainingMs / 60_000);
  return `~${minutes} minute${minutes === 1 ? "" : "s"} left (estimate)`;
}

function CandidateRow({
  candidate,
  players,
  quarter,
  matchId,
  onSeek,
  onResolved,
}: {
  candidate: Candidate;
  players: Player[];
  quarter: number;
  matchId: string;
  onSeek: (seconds: number) => void;
  onResolved: (candidateId: string) => void;
}) {
  const guessedPlayer = candidate.guessedPlayerId
    ? players.find((p) => p.id === candidate.guessedPlayerId) ?? null
    : null;
  const guessedType = MADE_TYPES.includes(candidate.guessedStatType as StatType)
    ? (candidate.guessedStatType as StatType)
    : null;

  const [editing, setEditing] = useState(!guessedPlayer || !guessedType);
  const [playerId, setPlayerId] = useState(candidate.guessedPlayerId ?? "");
  const [statType, setStatType] = useState<StatType | "">(guessedType ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    if (!playerId || !statType) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmCandidateAction(candidate.id, matchId, {
        playerId,
        type: statType,
        quarter,
      });
      if (result?.error) {
        setError(result.error);
      } else {
        onResolved(candidate.id);
      }
    });
  }

  function handleDismiss() {
    onResolved(candidate.id);
    startTransition(() => dismissCandidateAction(candidate.id, matchId));
  }

  return (
    <li className="rounded-lg bg-black/5 px-2 py-2 text-sm">
      <div className="flex items-center justify-between">
        <button
          onClick={() => onSeek(candidate.videoTimestampSeconds)}
          className="flex items-center gap-1 text-left font-medium text-navy hover:underline"
        >
          <span aria-hidden>▶</span>
          {formatTime(candidate.videoTimestampSeconds)} — {candidate.previousScoreText ?? "?"} →{" "}
          {candidate.scoreText ?? "?"}
        </button>
        <button onClick={handleDismiss} className="text-xs text-black/40 hover:text-black/70">
          Dismiss
        </button>
      </div>

      {!editing ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-xs text-black/60">
            AI guess:{" "}
            <span className="font-medium text-navy">
              #{guessedPlayer?.jerseyNumber} {guessedPlayer?.firstName}
            </span>{" "}
            — {STAT_LABELS[guessedType as StatType]}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-navy hover:underline"
            >
              Edit
            </button>
            <button
              onClick={handleConfirm}
              disabled={isPending}
              className="rounded-md bg-navy px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {(!guessedPlayer || !guessedType) && (
            <p className="text-xs text-black/40">
              Watch the clip above, then pick who scored and what it was.
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <select
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-brand"
            >
              <option value="">Player…</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.jerseyNumber} {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
            <select
              value={statType}
              onChange={(e) => setStatType(e.target.value as StatType)}
              className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-brand"
            >
              <option value="">Stat…</option>
              {MADE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STAT_LABELS[t]}
                </option>
              ))}
            </select>
            <button
              onClick={handleConfirm}
              disabled={isPending || !playerId || !statType}
              className="rounded-md bg-navy px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
            >
              {isPending ? "Saving…" : "Confirm"}
            </button>
            {guessedPlayer && guessedType && (
              <button
                onClick={() => setEditing(false)}
                className="text-xs text-black/40 hover:text-black/70"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
}

export function VideoAnalysisPanel({
  matchId,
  hasVideo,
  initialJob,
  players,
  quarter,
  onSeek,
}: {
  matchId: string;
  hasVideo: boolean;
  initialJob: Job;
  players: Player[];
  quarter: number;
  onSeek: (seconds: number) => void;
}) {
  const [job, setJob] = useState<Job>(initialJob);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [estimateLabel, setEstimateLabel] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const samplesRef = useRef<ProgressSample[]>([]);
  const progressRef = useRef(0);

  const isActive = job ? ACTIVE_STATUSES.includes(job.status) : false;

  function recordSample(progress: number) {
    const time = Date.now();
    progressRef.current = progress;
    const samples = samplesRef.current;
    samples.push({ progress, time });
    const cutoff = time - SAMPLE_WINDOW_MS;
    while (samples.length > 1 && samples[0].time < cutoff) samples.shift();
  }

  useEffect(() => {
    if (!isActive) {
      samplesRef.current = [];
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    samplesRef.current = [{ progress: job?.progress ?? 0, time: Date.now() }];
    progressRef.current = job?.progress ?? 0;
    pollRef.current = setInterval(() => {
      getVideoAnalysisStatus(matchId).then((latest) => {
        setJob(latest as Job);
        if (latest) recordSample(latest.progress);
      });
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, matchId]);

  // A timer-driven callback (not a plain derived-state effect) so the ETA
  // label re-evaluates every second even between polls, using whatever
  // samples have accumulated so far.
  useEffect(() => {
    if (!isActive) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => {
      const nowMs = Date.now();
      setEstimateLabel(estimateRemainingLabel(samplesRef.current, progressRef.current, nowMs));
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [isActive]);

  function handleStart() {
    setError(null);
    setEstimateLabel(null);
    startTransition(async () => {
      const result = await startVideoAnalysisAction(matchId);
      if (result?.error) {
        setError(result.error);
      } else {
        const latest = await getVideoAnalysisStatus(matchId);
        setJob(latest as Job);
      }
    });
  }

  function handleResolved(candidateId: string) {
    setJob((prev) =>
      prev ? { ...prev, candidates: prev.candidates.filter((c) => c.id !== candidateId) } : prev
    );
  }

  if (!hasVideo) return null;

  return (
    <div className="rounded-xl border border-black/5 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy">Suggested moments</h3>
        <button
          onClick={handleStart}
          disabled={isPending || isActive}
          className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-navy disabled:opacity-40"
        >
          {isActive ? "Analyzing…" : job?.status === "DONE" ? "Re-analyze" : "Analyze video"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {job && isActive && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
            <div
              className="h-1.5 rounded-full bg-brand transition-all"
              style={{ width: `${job.progress}%` }}
            />
          </div>
          <p className="mt-1 flex items-center justify-between text-xs text-black/40">
            <span>{STATUS_LABELS[job.status] ?? job.status}</span>
            <span>{estimateLabel}</span>
          </p>
        </div>
      )}

      {job?.status === "FAILED" && (
        <p className="mt-2 text-xs text-red-600">{job.errorMessage ?? "Something went wrong."}</p>
      )}

      {job?.status === "DONE" && job.candidates.length === 0 && (
        <p className="mt-2 text-xs text-black/40">
          No scoreboard changes were detected — the overlay may not be visible in this footage.
        </p>
      )}

      {job && job.candidates.length > 0 && (
        <>
          <p className="mt-3 text-xs text-black/40">
            AI-guessed suggestions — watch the clip, then confirm or correct each one. This never
            logs a stat on its own.
          </p>
          <ul className="mt-2 space-y-1.5">
            {job.candidates.map((c) => (
              <CandidateRow
                key={c.id}
                candidate={c}
                players={players}
                quarter={quarter}
                matchId={matchId}
                onSeek={onSeek}
                onResolved={handleResolved}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
