"use client";

import { useRef, useState, useTransition } from "react";
import {
  YoutubePlayer,
  type YoutubePlayerHandle,
} from "@/components/youtube-player";
import { LocalVideoPlayer } from "@/components/local-video-player";
import { ShotCourt } from "@/components/shot-court";
import { STAT_LABELS, STAT_TYPES, isShotType, type StatType } from "@/lib/stat-types";
import {
  logStatEventAction,
  deleteStatEventAction,
  updateStatEventAction,
} from "@/lib/actions/match-actions";
import { VideoAnalysisPanel } from "./video-analysis-panel";
import { UploadVideoForm } from "./upload-video-form";

type Player = {
  id: string;
  firstName: string;
  lastName: string;
  jerseyNumber: string;
};

type StatEvent = {
  id: string;
  playerId: string;
  type: string;
  quarter: number;
  videoTimestampSeconds: number | null;
  shotX: number | null;
  shotY: number | null;
};

type VideoAnalysisJob = {
  id: string;
  status: string;
  progress: number;
  errorMessage: string | null;
  createdAt: string | Date;
  candidates: {
    id: string;
    videoTimestampSeconds: number;
    previousScoreText: string | null;
    scoreText: string | null;
    guessedJerseyNumber: string | null;
    guessedStatType: string | null;
    guessedPlayerId: string | null;
    localizationConfidence: number | null;
    localizationMethod: string | null;
  }[];
} | null;

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TaggingWorkspace({
  matchId,
  youtubeVideoId,
  videoFileName,
  players,
  events,
  initialVideoJob,
}: {
  matchId: string;
  youtubeVideoId: string | null;
  videoFileName: string | null;
  players: Player[];
  events: StatEvent[];
  initialVideoJob: VideoAnalysisJob;
}) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(
    players[0]?.id ?? null
  );
  const [quarter, setQuarter] = useState(1);
  const [pendingShotType, setPendingShotType] = useState<StatType | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    playerId: string;
    type: StatType;
    quarter: number;
  } | null>(null);
  const playerRef = useRef<YoutubePlayerHandle>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  const selectedPlayer = players.find((p) => p.id === selectedPlayerId) ?? null;

  const hasVideo = Boolean(youtubeVideoId || videoFileName);

  function currentTimestamp(): number | undefined {
    if (!hasVideo || !playerRef.current) return undefined;
    return playerRef.current.getCurrentTime();
  }

  function skip(deltaSeconds: number) {
    if (!playerRef.current) return;
    const current = playerRef.current.getCurrentTime();
    playerRef.current.seekTo(Math.max(0, current + deltaSeconds));
  }

  // Suggested-moment rows can be far below the video on smaller screens, so
  // seeking alone isn't enough to confirm a guess against the footage — pull
  // the video back into view at the same time.
  function seekAndReveal(seconds: number) {
    playerRef.current?.seekTo(seconds);
    videoContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function logEvent(type: StatType, shotX?: number, shotY?: number) {
    if (!selectedPlayerId) return;
    startTransition(async () => {
      await logStatEventAction({
        matchId,
        playerId: selectedPlayerId,
        type,
        quarter,
        videoTimestampSeconds: currentTimestamp(),
        shotX,
        shotY,
      });
    });
  }

  function handleStatClick(type: StatType) {
    if (isShotType(type)) {
      setPendingShotType(type);
      return;
    }
    logEvent(type);
  }

  function handleCourtPick(x: number, y: number) {
    if (!pendingShotType) return;
    logEvent(pendingShotType, x, y);
    setPendingShotType(null);
  }

  function startEditEvent(e: StatEvent) {
    setEditingEventId(e.id);
    setEditDraft({ playerId: e.playerId, type: e.type as StatType, quarter: e.quarter });
  }

  function cancelEditEvent() {
    setEditingEventId(null);
    setEditDraft(null);
  }

  function saveEditEvent() {
    if (!editingEventId || !editDraft) return;
    const eventId = editingEventId;
    startTransition(async () => {
      await updateStatEventAction(eventId, matchId, editDraft);
    });
    setEditingEventId(null);
    setEditDraft(null);
  }

  const shots = events
    .filter((e) => isShotType(e.type) && e.shotX !== null && e.shotY !== null)
    .map((e) => ({
      x: e.shotX as number,
      y: e.shotY as number,
      made: e.type.endsWith("MADE"),
    }));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <div ref={videoContainerRef}>
          {videoFileName ? (
            <LocalVideoPlayer ref={playerRef} matchId={matchId} />
          ) : youtubeVideoId ? (
            <YoutubePlayer ref={playerRef} videoId={youtubeVideoId} />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-xl bg-black/5 text-sm text-black/40">
              No video linked to this match yet.
            </div>
          )}
        </div>

        {hasVideo && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => skip(-30)}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:border-brand"
            >
              ◀◀ 30s
            </button>
            <button
              onClick={() => skip(-10)}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:border-brand"
            >
              ◀ 10s
            </button>
            <button
              onClick={() => skip(10)}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:border-brand"
            >
              10s ▶
            </button>
            <button
              onClick={() => skip(30)}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:border-brand"
            >
              30s ▶▶
            </button>
          </div>
        )}

        {!videoFileName && (
          <UploadVideoForm
            matchId={matchId}
            hint={
              youtubeVideoId
                ? "Having trouble with the YouTube link (e.g. it fails to download for analysis)? Upload the video file directly instead — this replaces the YouTube link for this match."
                : undefined
            }
          />
        )}

        <div className="rounded-xl border border-black/5 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase text-black/40">
              Player
            </span>
            {players.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPlayerId(p.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  selectedPlayerId === p.id
                    ? "bg-navy text-white"
                    : "bg-black/5 text-black/70 hover:bg-black/10"
                }`}
              >
                #{p.jerseyNumber} {p.firstName}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase text-black/40">
              Quarter
            </span>
            {[1, 2, 3, 4].map((q) => (
              <button
                key={q}
                onClick={() => setQuarter(q)}
                className={`h-8 w-8 rounded-lg text-sm font-semibold transition ${
                  quarter === q
                    ? "bg-brand text-navy"
                    : "bg-black/5 text-black/60 hover:bg-black/10"
                }`}
              >
                Q{q}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {STAT_TYPES.map((type) => (
              <button
                key={type}
                disabled={!selectedPlayerId || isPending}
                onClick={() => handleStatClick(type)}
                className="rounded-lg border border-black/10 px-2 py-2 text-sm font-medium text-navy transition hover:border-brand hover:bg-brand/10 disabled:opacity-40"
              >
                {STAT_LABELS[type]}
              </button>
            ))}
          </div>

          {!selectedPlayerId && (
            <p className="mt-2 text-xs text-black/40">
              Select a player above to start logging stats.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-black/5 bg-white p-4">
          <h3 className="text-sm font-semibold text-navy">Recent events</h3>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
            {events
              .slice()
              .reverse()
              .map((e) => {
                const player = players.find((p) => p.id === e.playerId);

                if (editingEventId === e.id && editDraft) {
                  return (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center gap-1.5 rounded-lg bg-brand/5 px-2 py-1.5"
                    >
                      <select
                        value={editDraft.playerId}
                        onChange={(ev) =>
                          setEditDraft({ ...editDraft, playerId: ev.target.value })
                        }
                        className="rounded border border-black/10 bg-white px-1.5 py-1 text-xs"
                      >
                        {players.map((p) => (
                          <option key={p.id} value={p.id}>
                            #{p.jerseyNumber} {p.firstName}
                          </option>
                        ))}
                      </select>
                      <select
                        value={editDraft.type}
                        onChange={(ev) =>
                          setEditDraft({ ...editDraft, type: ev.target.value as StatType })
                        }
                        className="rounded border border-black/10 bg-white px-1.5 py-1 text-xs"
                      >
                        {STAT_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {STAT_LABELS[type]}
                          </option>
                        ))}
                      </select>
                      <select
                        value={editDraft.quarter}
                        onChange={(ev) =>
                          setEditDraft({ ...editDraft, quarter: Number(ev.target.value) })
                        }
                        className="rounded border border-black/10 bg-white px-1.5 py-1 text-xs"
                      >
                        {[1, 2, 3, 4].map((q) => (
                          <option key={q} value={q}>
                            Q{q}
                          </option>
                        ))}
                      </select>
                      <span className="ml-auto flex items-center gap-2">
                        <button
                          onClick={saveEditEvent}
                          disabled={isPending}
                          className="text-xs font-medium text-navy hover:underline disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEditEvent}
                          className="text-xs text-black/50 hover:underline"
                        >
                          Cancel
                        </button>
                      </span>
                    </li>
                  );
                }

                return (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-black/5"
                  >
                    <span>
                      Q{e.quarter} · #{player?.jerseyNumber} {player?.firstName}{" "}
                      — {STAT_LABELS[e.type as StatType] ?? e.type}
                      {e.videoTimestampSeconds != null && (
                        <span className="ml-2 text-black/40">
                          {formatTime(e.videoTimestampSeconds)}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      <button
                        onClick={() => startEditEvent(e)}
                        className="text-xs text-navy hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() =>
                          startTransition(() => deleteStatEventAction(e.id, matchId))
                        }
                        className="text-xs text-red-500 hover:underline"
                      >
                        Undo
                      </button>
                    </span>
                  </li>
                );
              })}
            {events.length === 0 && (
              <li className="px-2 py-4 text-center text-black/40">
                No events logged yet.
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-black/5 bg-white p-4">
          <h3 className="text-sm font-semibold text-navy">Shot chart</h3>
          <div className="mt-3">
            <ShotCourt shots={shots} />
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-black/50">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-navy" /> Made
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-red-400 bg-white" />{" "}
              Missed
            </span>
          </div>
        </div>

        {selectedPlayer && (
          <p className="rounded-xl border border-black/5 bg-white p-4 text-sm text-black/60">
            Logging for{" "}
            <span className="font-semibold text-navy">
              #{selectedPlayer.jerseyNumber} {selectedPlayer.firstName}{" "}
              {selectedPlayer.lastName}
            </span>
            , Quarter {quarter}.
          </p>
        )}

        <VideoAnalysisPanel
          matchId={matchId}
          hasVideo={hasVideo}
          initialJob={initialVideoJob}
          players={players}
          quarter={quarter}
          onSeek={seekAndReveal}
        />
      </div>

      {pendingShotType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy">
                Tap the shot location — {STAT_LABELS[pendingShotType]}
              </h3>
              <button
                onClick={() => setPendingShotType(null)}
                className="text-sm text-black/40 hover:text-black/70"
              >
                Cancel
              </button>
            </div>
            <div className="mt-3">
              <ShotCourt shots={shots} onPick={handleCourtPick} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
