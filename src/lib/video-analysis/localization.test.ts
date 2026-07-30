import { describe, expect, it } from "vitest";
import { computeLocalizationWindow, MAX_LOCALIZATION_WINDOW_SECONDS } from "./localization";

describe("computeLocalizationWindow", () => {
  it("pads a few seconds before gapStart for a normal-sized gap", () => {
    const window = computeLocalizationWindow(100, 115);
    expect(window.start).toBe(97);
    expect(window.end).toBe(115);
  });

  it("never returns a negative start, even near the beginning of the video", () => {
    const window = computeLocalizationWindow(1, 10);
    expect(window.start).toBe(0);
    expect(window.end).toBe(10);
    expect(window.start).toBeGreaterThanOrEqual(0);
  });

  it("caps the window at MAX_LOCALIZATION_WINDOW_SECONDS when the gap is longer", () => {
    const gapStart = 100;
    const gapEnd = 500; // a 400s gap — e.g. a long stoppage
    const window = computeLocalizationWindow(gapStart, gapEnd);

    expect(window.end - window.start).toBeLessThanOrEqual(MAX_LOCALIZATION_WINDOW_SECONDS);
    // prioritizes the final seconds before gapEnd, since the new score just became visible
    expect(window.end).toBe(gapEnd);
    expect(window.start).toBe(gapEnd - MAX_LOCALIZATION_WINDOW_SECONDS);
  });

  it("keeps the window within the video for a gap that starts at time 0", () => {
    const window = computeLocalizationWindow(0, 5);
    expect(window.start).toBe(0);
    expect(window.end).toBe(5);
  });

  it("always returns a window with end >= start", () => {
    const cases: [number, number][] = [
      [0, 1],
      [10, 10],
      [1000, 1001],
      [0, 1000],
    ];
    for (const [gapStart, gapEnd] of cases) {
      const window = computeLocalizationWindow(gapStart, gapEnd);
      expect(window.end).toBeGreaterThanOrEqual(window.start);
      expect(window.start).toBeGreaterThanOrEqual(0);
    }
  });
});
