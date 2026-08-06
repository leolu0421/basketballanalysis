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
 * A real single basket only ever changes one team's score, by exactly 1, 2,
 * or 3 points. Confirmed in production: candidates like "2-0 -> 14-13" (both
 * sides jumping by double digits) show up when the scoreboard OCR misreads a
 * digit, or when several real baskets happened between two scoreboard
 * sightings and got collapsed into one candidate — either way, there's no
 * single scoring player to attribute that delta to, so guessing one is
 * actively misleading rather than just imprecise.
 */
export function isPlausibleScoreDelta(previousScoreText: string, scoreText: string): boolean {
  const prev = parseScorePair(previousScoreText);
  const next = parseScorePair(scoreText);
  if (!prev || !next) return true; // unparseable — don't block on a format we don't recognize

  const [prevA, prevB] = prev;
  const [nextA, nextB] = next;
  const deltaA = nextA - prevA;
  const deltaB = nextB - prevB;

  if (deltaA !== 0 && deltaB !== 0) return false; // both sides changed at once
  const delta = deltaA !== 0 ? deltaA : deltaB;
  return delta >= 1 && delta <= 3;
}

function parseScorePair(text: string): [number, number] | null {
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

/**
 * Diffs a sequence of per-frame scoreboard reads and returns one candidate
 * for every point where the visible score text changed, with the timestamp
 * approximated as the midpoint between the last old-score read and the
 * first new-score read.
 *
 * Confirmed in production: a single misread frame (Claude vision reading
 * "21" when the board still said "19") produced a candidate that looked
 * like a perfectly plausible 2-point basket — isPlausibleScoreDelta can't
 * catch this, since a wrong digit can land just as plausibly as a real one.
 * To guard against a one-off misread, a new score isn't accepted until a
 * SECOND, later read confirms the same value; a reading that never
 * recurs is treated as a blip and dropped rather than turned into a
 * candidate. This trades away catching a genuinely final, never-reconfirmed
 * score change (e.g. the last basket before the board goes obscured for
 * good) in exchange for not generating spurious, wrongly-attributed
 * candidates from transient OCR errors — the better trade here since a
 * coach can always log a missed basket manually, but a wrong AI guess
 * actively misleads.
 *
 * Confirmed in production (see the "Localized: 1" AnalysisSummary
 * investigation): a single-slot version of this confirmation rule — only
 * ever remembering the ONE most recent not-yet-confirmed reading — silently
 * destroyed real data whenever two or more real baskets happened close
 * enough together that a new score got superseded by the NEXT real basket
 * before it ever got the chance to repeat. Each of those in-between
 * readings was individually a perfectly ordinary, plausible single-basket
 * delta — they just never happened to recur, because the game had already
 * moved on by the following sample. The single-slot version threw every one
 * of them away and produced ONE oversized candidate spanning the whole
 * burst (first score -> whatever value finally did repeat), with a combined
 * delta across several baskets — exactly the "both sides changed" and
 * "long merged gap" patterns seen in production, both of which then got
 * excluded from localization entirely by isPlausibleScoreDelta downstream,
 * since a multi-basket delta has no single scoring player to attribute.
 *
 * Fixed by remembering the WHOLE chain of distinct readings seen since the
 * last confirmed score, not just the latest one. A repeat of the chain's
 * most recent entry still confirms it — the anti-misread guarantee above is
 * unchanged, nothing is ever trusted without recurring — but confirming now
 * walks the entire chain and emits one candidate per link (confirmed ->
 * link1, link1 -> link2, ...) instead of collapsing everything straight
 * from the original confirmed score to the final value. This function still
 * doesn't filter by delta plausibility itself (that stays isPlausibleScoreDelta's
 * job, applied per-link downstream in pipeline.ts) — it only fixes
 * detection, so a genuine burst of real baskets now produces several
 * individually-attributable candidates instead of one useless merged one.
 */
export type BuildCandidatesStats = {
  visibleReads: number;
  rawChangesDetected: number;
  discardedUnconfirmed: number;
};

export function buildScoreCandidates(
  reads: FrameRead[],
  frameIntervalSeconds: number,
  stats?: BuildCandidatesStats
): ScoreCandidate[] {
  const sorted = [...reads]
    .filter((r) => r.scoreVisible && r.scoreText)
    .sort((a, b) => a.frameIndex - b.frameIndex) as (FrameRead & { scoreText: string })[];
  if (stats) stats.visibleReads = sorted.length;
  const candidates: ScoreCandidate[] = [];
  if (sorted.length === 0) return candidates;

  let confirmed = { index: sorted[0].frameIndex, scoreText: sorted[0].scoreText };
  // Every distinct reading seen since `confirmed`, in the order first seen —
  // NOT just the single latest one. See the doc comment above for why a
  // single slot here used to silently drop real, back-to-back baskets.
  let chain: { index: number; scoreText: string }[] = [];

  const discardChain = (reason: string) => {
    for (const link of chain) {
      if (stats) stats.discardedUnconfirmed++;
      console.log(
        `[video-analysis] discarded unconfirmed reading "${link.scoreText}" at ~${link.index * frameIntervalSeconds}s (${reason})`
      );
    }
    chain = [];
  };

  for (let i = 1; i < sorted.length; i++) {
    const read = sorted[i];

    if (read.scoreText === confirmed.scoreText) {
      // Back to the known-good score — the whole chain built up since then
      // (if any) was a blip/replay/misread that never actually stuck.
      discardChain(`reverted to "${confirmed.scoreText}"`);
      continue;
    }

    if (stats) stats.rawChangesDetected++;

    const lastLink = chain[chain.length - 1];
    if (lastLink && read.scoreText === lastLink.scoreText) {
      // The most recent hypothesis just recurred — confirm the ENTIRE chain
      // that led up to it, not just this last link, emitting one candidate
      // per step.
      let prev = confirmed;
      for (const link of chain) {
        const midpointIndex = (prev.index + link.index) / 2;
        candidates.push({
          videoTimestampSeconds: midpointIndex * frameIntervalSeconds,
          previousScoreText: prev.scoreText,
          scoreText: link.scoreText,
          gapStartSeconds: prev.index * frameIntervalSeconds,
          gapEndSeconds: link.index * frameIntervalSeconds,
        });
        prev = link;
      }
      confirmed = { index: read.frameIndex, scoreText: read.scoreText };
      chain = [];
    } else {
      // A new distinct reading — appended alongside any earlier ones in the
      // chain (not overwriting them), so it isn't lost if a DIFFERENT real
      // basket supersedes it before it gets the chance to repeat itself.
      chain.push({ index: read.frameIndex, scoreText: read.scoreText });
    }
  }

  discardChain("never re-confirmed before scoreboard reads ran out");

  return candidates;
}
