import type { FrameRead } from "./vision";

export type ScoreCandidate = {
  videoTimestampSeconds: number;
  previousScoreText: string;
  scoreText: string;
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
      });
    }

    lastKnown = { index: read.frameIndex, scoreText: read.scoreText };
  }

  return candidates;
}
