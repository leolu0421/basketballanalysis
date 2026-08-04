import { describe, expect, it } from "vitest";
import { computeLocalizationWindow, summarizeLocalizations, MAX_LOCALIZATION_WINDOW_SECONDS } from "./localization";

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

describe("summarizeLocalizations", () => {
  it("splits vision/no-evidence/error into distinct buckets, matching the real 16-candidate case", () => {
    // Reproduces the "Candidates: 16, Localized: 1" report: one early
    // success, then every later candidate skipped entirely because
    // tracking broke (never even attempted, not fallback/failed).
    const localizations = [
      { method: "vision" as const, confidence: 0.9 },
      undefined,
      undefined,
      undefined,
    ];
    const summary = summarizeLocalizations(16, localizations);

    expect(summary.candidatesTotal).toBe(16);
    expect(summary.success).toBe(1);
    expect(summary.attempts).toBe(1);
    // skipped = candidates never attempted at all (implausible delta, or
    // legacy fallback after a tracking break) -- not the same as "failed"
    expect(summary.skipped).toBe(15);
    expect(summary.fallbackError).toBe(0);
    expect(summary.fallbackNoEvidence).toBe(0);
  });

  it("keeps fallback (no evidence) and failed (error) as separate counts", () => {
    const localizations = [
      { method: "vision" as const, confidence: 0.95 },
      { method: "fallback_no_evidence" as const, confidence: 0 },
      { method: "fallback_no_evidence" as const, confidence: 0 },
      { method: "fallback_error" as const, confidence: 0 },
    ];
    const summary = summarizeLocalizations(4, localizations);

    expect(summary.success).toBe(1);
    expect(summary.fallbackNoEvidence).toBe(2);
    expect(summary.fallbackError).toBe(1);
    expect(summary.attempts).toBe(4);
    expect(summary.skipped).toBe(0);
  });

  it("attempts + skipped always equals candidatesTotal", () => {
    const localizations = [{ method: "vision" as const, confidence: 0.7 }, undefined];
    const summary = summarizeLocalizations(5, localizations);
    expect(summary.attempts + summary.skipped).toBe(summary.candidatesTotal);
  });

  it("attempts always equals success + fallbackNoEvidence + fallbackError", () => {
    const localizations = [
      { method: "vision" as const, confidence: 0.6 },
      { method: "fallback_no_evidence" as const, confidence: 0 },
      { method: "fallback_error" as const, confidence: 0 },
    ];
    const summary = summarizeLocalizations(3, localizations);
    expect(summary.attempts).toBe(summary.success + summary.fallbackNoEvidence + summary.fallbackError);
  });

  it("computes average confidence across attempts only, not skipped candidates", () => {
    const localizations = [
      { method: "vision" as const, confidence: 1.0 },
      { method: "vision" as const, confidence: 0.5 },
    ];
    const summary = summarizeLocalizations(10, localizations);
    expect(summary.averageAttemptConfidence).toBeCloseTo(0.75);
  });

  it("returns null average confidence when there are no attempts", () => {
    const summary = summarizeLocalizations(3, [undefined, undefined, undefined]);
    expect(summary.averageAttemptConfidence).toBeNull();
  });
});
