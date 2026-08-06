import { describe, expect, it } from "vitest";
import { buildScoreCandidates, isPlausibleScoreDelta } from "./candidates";
import type { FrameRead } from "./vision";

function read(frameIndex: number, scoreText: string | null): FrameRead {
  return { frameIndex, scoreVisible: scoreText !== null, scoreText };
}

const FRAME_INTERVAL = 15;

describe("buildScoreCandidates", () => {
  it("creates one candidate for a normal adjacent score change, confirmed by a third read", () => {
    const reads = [read(0, "0-0"), read(1, "2-0"), read(2, "2-0")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      previousScoreText: "0-0",
      scoreText: "2-0",
      gapStartSeconds: 0,
      gapEndSeconds: 15,
    });
    expect(candidates[0].videoTimestampSeconds).toBeCloseTo(7.5);
  });

  it("keeps correct gapStartSeconds/gapEndSeconds when the scoreboard was hidden for several intervals", () => {
    // Board visible at 0 (score "0-0"), then hidden for frames 1-3, then
    // visible again at 4 and 5 both showing "2-0" (confirming the change).
    const reads = [read(0, "0-0"), read(4, "2-0"), read(5, "2-0")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].gapStartSeconds).toBe(0);
    expect(candidates[0].gapEndSeconds).toBe(4 * FRAME_INTERVAL);
    // midpoint of the WIDE gap, not a tight window around either end
    expect(candidates[0].videoTimestampSeconds).toBeCloseTo((0 + 4 * FRAME_INTERVAL) / 2);
  });

  it("does not create a candidate for a one-off reading that's never confirmed (likely OCR misread)", () => {
    // "21-24" appears once, then reverts back to "19-24" — a misread blip.
    const reads = [read(0, "19-24"), read(1, "21-24"), read(2, "19-24"), read(3, "19-24")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(0);
  });

  it("confirms a score change once the same new value recurs, even after an earlier blip", () => {
    const reads = [
      read(0, "19-24"),
      read(1, "21-24"), // blip, discarded
      read(2, "19-24"), // back to known-good
      read(3, "19-26"), // real change starts
      read(4, "19-26"), // confirmed
    ];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ previousScoreText: "19-24", scoreText: "19-26" });
  });

  it("handles a genuinely wide gap (long stoppage) and still returns correct gap fields", () => {
    const reads = [read(0, "10-8"), read(10, "12-8"), read(11, "12-8")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].gapStartSeconds).toBe(0);
    expect(candidates[0].gapEndSeconds).toBe(10 * FRAME_INTERVAL);
  });

  it("ignores frames where the scoreboard isn't visible", () => {
    const reads = [read(0, "0-0"), read(1, null), read(2, "2-0"), read(3, "2-0")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].previousScoreText).toBe("0-0");
    expect(candidates[0].scoreText).toBe("2-0");
  });

  it("returns no candidates when the score never changes", () => {
    const reads = [read(0, "5-5"), read(1, "5-5"), read(2, "5-5")];
    expect(buildScoreCandidates(reads, FRAME_INTERVAL)).toHaveLength(0);
  });

  it("recovers both baskets from a back-to-back burst instead of merging them into one implausible candidate", () => {
    // 19-18 -> 21-18 (basket 1, seen once) -> 23-18 (basket 2, before basket
    // 1 ever repeats) -> 23-18 (confirms basket 2). A single-pending-slot
    // implementation would silently drop "21-18" entirely and produce one
    // merged 19-18 -> 23-18 candidate (a +4 delta with no real scoring
    // player). See the "Localized: 1" investigation this fixes.
    const reads = [read(0, "19-18"), read(1, "19-18"), read(2, "21-18"), read(3, "23-18"), read(4, "23-18")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      previousScoreText: "19-18",
      scoreText: "21-18",
      gapStartSeconds: 0,
      gapEndSeconds: 2 * FRAME_INTERVAL,
    });
    expect(candidates[1]).toMatchObject({
      previousScoreText: "21-18",
      scoreText: "23-18",
      gapStartSeconds: 2 * FRAME_INTERVAL,
      gapEndSeconds: 3 * FRAME_INTERVAL,
    });
    // Both links are individually plausible single-basket deltas, unlike
    // the merged 19-18 -> 23-18 a single-slot implementation would produce.
    expect(isPlausibleScoreDelta(candidates[0].previousScoreText, candidates[0].scoreText)).toBe(true);
    expect(isPlausibleScoreDelta(candidates[1].previousScoreText, candidates[1].scoreText)).toBe(true);
  });

  it("recovers a both-sides-changed burst into two single-team candidates", () => {
    // 35-35 -> 38-35 (home scores, seen once) -> 38-36 (away scores, before
    // the home basket ever repeats) -> 38-36 (confirms). The raw
    // first -> last delta ("35-35" -> "38-36") is a both-sides-changed jump
    // that isPlausibleScoreDelta correctly rejects — but each individual
    // link is a normal single-basket delta and should be recovered as such.
    const reads = [read(0, "35-35"), read(1, "35-35"), read(2, "38-35"), read(3, "38-36"), read(4, "38-36")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ previousScoreText: "35-35", scoreText: "38-35" });
    expect(candidates[1]).toMatchObject({ previousScoreText: "38-35", scoreText: "38-36" });
    expect(isPlausibleScoreDelta("35-35", "38-36")).toBe(false); // the merged jump a buggy version would produce
    expect(isPlausibleScoreDelta(candidates[0].previousScoreText, candidates[0].scoreText)).toBe(true);
    expect(isPlausibleScoreDelta(candidates[1].previousScoreText, candidates[1].scoreText)).toBe(true);
  });

  it("recovers a 3-basket burst (chain longer than 2 links) in order", () => {
    const reads = [
      read(0, "0-0"),
      read(1, "2-0"), // basket 1
      read(2, "4-0"), // basket 2, before basket 1 repeats
      read(3, "5-0"), // basket 3, before basket 2 repeats
      read(4, "5-0"), // confirms
    ];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => [c.previousScoreText, c.scoreText])).toEqual([
      ["0-0", "2-0"],
      ["2-0", "4-0"],
      ["4-0", "5-0"],
    ]);
  });

  it("still discards a chain that reverts to the known-good score, even mid-burst", () => {
    // A real-looking burst starts (21-18), but then the board reverts to
    // the original confirmed score (19-18) instead of any chain value ever
    // repeating — the whole in-progress chain is a misread and is dropped.
    const reads = [read(0, "19-18"), read(1, "21-18"), read(2, "23-18"), read(3, "19-18"), read(4, "19-18")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(0);
  });

  it("does not regress the single-basket case: still exactly one candidate, same fields as before", () => {
    const reads = [read(0, "19-18"), read(1, "21-18"), read(2, "21-18")];
    const candidates = buildScoreCandidates(reads, FRAME_INTERVAL);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      previousScoreText: "19-18",
      scoreText: "21-18",
      gapStartSeconds: 0,
      gapEndSeconds: 1 * FRAME_INTERVAL,
    });
  });
});

describe("isPlausibleScoreDelta", () => {
  it("accepts a real single-basket delta of 1, 2, or 3 points", () => {
    expect(isPlausibleScoreDelta("0-0", "2-0")).toBe(true);
    expect(isPlausibleScoreDelta("0-0", "3-0")).toBe(true);
    expect(isPlausibleScoreDelta("10-10", "10-11")).toBe(true);
  });

  it("rejects a delta bigger than 3 points to one side", () => {
    expect(isPlausibleScoreDelta("2-0", "6-0")).toBe(false);
  });

  it("rejects both sides changing at once", () => {
    expect(isPlausibleScoreDelta("2-0", "14-13")).toBe(false);
    expect(isPlausibleScoreDelta("19-24", "21-26")).toBe(false);
  });

  it("passes through unparseable score text without blocking", () => {
    expect(isPlausibleScoreDelta("??", "2-0")).toBe(true);
  });
});
