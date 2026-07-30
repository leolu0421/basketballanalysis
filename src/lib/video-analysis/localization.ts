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
