/**
 * Event localization: given the gap where a scoreboard change was detected
 * (see candidates.ts), figures out which narrower time window to sample
 * densely for the actual scoring play, before any player/jersey guessing
 * happens. Kept separate from vision/pipeline so the pure window math is
 * unit-testable without ffmpeg or network calls, and so a future
 * shot/hoop-detection model can replace how the window gets *searched*
 * (localizeScoringMoment in vision.ts) without touching this calculation.
 */

export const LOCALIZATION_PRE_PADDING_SECONDS = 3;
export const MAX_LOCALIZATION_WINDOW_SECONDS = 25;

export type LocalizationWindow = { start: number; end: number };

/**
 * The real basket could have happened anywhere from just before the old
 * score was last confirmed visible, up to the moment the new score was
 * first confirmed visible. That full span can be large if the scoreboard
 * was obscured for a while (camera pans away, replay, foul review) — bounded
 * here to MAX_LOCALIZATION_WINDOW_SECONDS so a single long stoppage doesn't
 * blow up how many frames get sent to Claude. When the natural gap is too
 * long, the final seconds before gapEndSeconds are prioritized, since
 * that's closest to when the new score actually became visible.
 */
export function computeLocalizationWindow(
  gapStartSeconds: number,
  gapEndSeconds: number
): LocalizationWindow {
  const naturalStart = Math.max(0, gapStartSeconds - LOCALIZATION_PRE_PADDING_SECONDS);
  const naturalDuration = gapEndSeconds - naturalStart;

  if (naturalDuration <= MAX_LOCALIZATION_WINDOW_SECONDS) {
    return { start: naturalStart, end: gapEndSeconds };
  }

  return {
    start: Math.max(0, gapEndSeconds - MAX_LOCALIZATION_WINDOW_SECONDS),
    end: gapEndSeconds,
  };
}

export type LocalizationSummary = {
  candidatesTotal: number;
  attempts: number;
  success: number;
  fallbackNoEvidence: number;
  fallbackError: number;
  skipped: number;
  averageAttemptConfidence: number | null;
};

/**
 * Turns the per-candidate localization array (one slot per candidate —
 * undefined for any that never got an attempt at all, e.g. an implausible
 * delta or a candidate routed to the legacy wide-frame fallback after an
 * earlier tracking failure) into exact, auditable counts for the /eval
 * page. Deliberately a plain function over plain data — no ffmpeg, no
 * Prisma, no network — so this counting logic itself is unit-testable
 * rather than trusted on faith.
 *
 * `attempts` (= not skipped) is always success + fallbackNoEvidence +
 * fallbackError, and `skipped` + `attempts` is always candidatesTotal —
 * every candidate is accounted for in exactly one bucket.
 */
export function summarizeLocalizations(
  candidatesTotal: number,
  localizations: Array<{ method: "vision" | "fallback_no_evidence" | "fallback_error"; confidence: number } | undefined>
): LocalizationSummary {
  const attempted = localizations.filter(
    (l): l is { method: "vision" | "fallback_no_evidence" | "fallback_error"; confidence: number } => l != null
  );

  const success = attempted.filter((l) => l.method === "vision").length;
  const fallbackNoEvidence = attempted.filter((l) => l.method === "fallback_no_evidence").length;
  const fallbackError = attempted.filter((l) => l.method === "fallback_error").length;

  return {
    candidatesTotal,
    attempts: attempted.length,
    success,
    fallbackNoEvidence,
    fallbackError,
    skipped: candidatesTotal - attempted.length,
    averageAttemptConfidence:
      attempted.length > 0 ? attempted.reduce((sum, l) => sum + l.confidence, 0) / attempted.length : null,
  };
}
