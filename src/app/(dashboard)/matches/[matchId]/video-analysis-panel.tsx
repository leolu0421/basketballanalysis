"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  startVideoAnalysisAction,
  getVideoAnalysisStatus,
  dismissCandidateAction,
} from "@/lib/actions/video-analysis-actions";

type Candidate = {
  id: string;
  videoTimestampSeconds: number;
  previousScoreText: string | null;
  scoreText: string | null;
};

type Job = {
  id: string;
  status: string;
  progress: number;
  errorMessage: string | null;
  candidates: Candidate[];
} | null;

const ACTIVE_STATUSES = ["PENDING", "DOWNLOADING", "EXTRACTING", "ANALYZING"];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Queued…",
  DOWNLOADING: "Downloading video…",
  EXTRACTING: "Extracting frames…",
  ANALYZING: "Reading scoreboard…",
  DONE: "Done",
  FAILED: "Failed",
};

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoAnalysisPanel({
  matchId,
  hasVideo,
  initialJob,
  onSeek,
}: {
  matchId: string;
  hasVideo: boolean;
  initialJob: Job;
  onSeek: (seconds: number) => void;
}) {
  const [job, setJob] = useState<Job>(initialJob);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = job ? ACTIVE_STATUSES.includes(job.status) : false;

  useEffect(() => {
    if (!isActive) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(() => {
      getVideoAnalysisStatus(matchId).then((latest) => setJob(latest as Job));
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isActive, matchId]);

  function handleStart() {
    setError(null);
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

  function handleDismiss(candidateId: string) {
    setJob((prev) =>
      prev ? { ...prev, candidates: prev.candidates.filter((c) => c.id !== candidateId) } : prev
    );
    startTransition(() => dismissCandidateAction(candidateId, matchId));
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
          <p className="mt-1 text-xs text-black/40">
            {STATUS_LABELS[job.status] ?? job.status}
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
        <ul className="mt-3 space-y-1.5">
          {job.candidates.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-lg bg-black/5 px-2 py-1.5 text-sm"
            >
              <button
                onClick={() => onSeek(c.videoTimestampSeconds)}
                className="text-left text-navy hover:underline"
              >
                {formatTime(c.videoTimestampSeconds)} — {c.previousScoreText ?? "?"} →{" "}
                {c.scoreText ?? "?"}
              </button>
              <button
                onClick={() => handleDismiss(c.id)}
                className="text-xs text-black/40 hover:text-black/70"
              >
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
