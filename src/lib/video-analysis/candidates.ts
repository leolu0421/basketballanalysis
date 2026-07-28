import type { FrameRead } from "./vision";

export type ScoreCandidate = {
  videoTimestampSeconds: number;
  previousScoreText: string;
  scoreText: string;
  // Not persisted to the DB — only used in-memory to size the tracking
  // clip (see trackCandidate in pipeline.ts). The actual scoring play could
  // have happened anywhere between these two timestamps: gapStartSeconds is
  // the last frame where the old score was confirmed visible, gapEndSeconds
  // is the first frame where the new score was confirmed visible. If the
  // scoreboard was obscured for several sample intervals in between (camera
  // panned away, replay, foul review), that gap can be much wider than one
  // frame interval, and videoTimestampSeconds (its midpoint) can land
  // nowhere near the real play.
  gapStartSeconds: number;
  gapEndSeconds: number;
};

/**
 * Diffs a sequence of per-frame scoreboard reads and returns one candidate
 * for every point where the visible score text changed, with the timestamp
 * approximated as the midpoint between the last old-score read and the
 * first new-score read.
 */
export function buildScoreCandidates(
  reads: FrameRead[],
  frameIntervalSeconds: number
): ScoreCandidate[] {
  const sorted = [...reads].sort((a, b) => a.frameIndex - b.frameIndex);
  const candidates: ScoreCandidate[] = [];
  let lastKnown: { index: number; scoreText: string } | null = null;

  for (const read of sorted) {
    if (!read.scoreVisible || !read.scoreText) continue;

    if (lastKnown && read.scoreText !== lastKnown.scoreText) {
      const midpointIndex = (lastKnown.index + read.frameIndex) / 2;
      candidates.push({
        videoTimestampSeconds: midpointIndex * frameIntervalSeconds,
        previousScoreText: lastKnown.scoreText,
        scoreText: read.scoreText,
        gapStartSeconds: lastKnown.index * frameIntervalSeconds,
        gapEndSeconds: read.frameIndex * frameIntervalSeconds,
      });
    }

    lastKnown = { index: read.frameIndex, scoreText: read.scoreText };
  }

  return candidates;
}
