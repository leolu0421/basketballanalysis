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
