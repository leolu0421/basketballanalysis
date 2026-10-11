import { STAT_TYPES } from "../stat-types";

export type DatasetEvent = {
  id: string;
  playerId: string;
  type: string;
  quarter: number;
  videoTimestampSeconds: number | null;
  source: string;
};

/** Export labels, not video or personal information. Partial annotations
 * do not imply unlabelled plays are negatives or that a game is complete. */
export function buildMatchDataset(match: {
  id: string;
  youtubeVideoId: string | null;
  videoFileName: string | null;
  players: { id: string; jerseyNumber: string }[];
  events: DatasetEvent[];
}) {
  const players = new Map(match.players.map((p) => [p.id, p.jerseyNumber]));
  const usable = match.events.filter((e) =>
    e.videoTimestampSeconds !== null && Number.isFinite(e.videoTimestampSeconds) &&
    e.videoTimestampSeconds >= 0 && players.has(e.playerId) &&
    STAT_TYPES.some((type) => type === e.type)
  );
  const labels = usable.map((e) => ({
    eventId: e.id,
    playerId: e.playerId,
    jerseyNumber: players.get(e.playerId)!,
    type: e.type,
    quarter: e.quarter,
    timestampSeconds: e.videoTimestampSeconds!,
    source: e.source,
  }));
  return {
    schemaVersion: 1,
    matchId: match.id,
    annotationCoverage: "partial" as const,
    video: match.videoFileName
      ? { kind: "uploaded", path: `/api/matches/${match.id}/video` }
      : match.youtubeVideoId
        ? { kind: "youtube", videoId: match.youtubeVideoId }
        : null,
    // Evaluation uses independent manual labels, never the AI's own output.
    groundTruth: labels.filter((e) => e.source === "MANUAL"),
    reviewedSuggestions: labels.filter((e) => e.source === "AI_CONFIRMED"),
    unverified: labels.filter((e) => !["MANUAL", "AI_CONFIRMED"].includes(e.source)),
    excludedEventCount: match.events.length - labels.length,
  };
}
