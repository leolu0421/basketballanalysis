/**
 * Guards against confirming the same real-world score twice — e.g. a coach
 * double-clicking Confirm, or two candidates (one from event localization,
 * one from a manual log) both pointing at the same basket. Kept as a pure
 * predicate so it's unit-testable without touching Prisma.
 */

export const DUPLICATE_TOLERANCE_SECONDS = 2;

export type ExistingEvent = {
  playerId: string;
  type: string;
  videoTimestampSeconds: number | null;
};

export function isDuplicateEvent(
  existingEvents: ExistingEvent[],
  candidate: { playerId: string; type: string; videoTimestampSeconds: number | null },
  toleranceSeconds: number = DUPLICATE_TOLERANCE_SECONDS
): boolean {
  if (candidate.videoTimestampSeconds == null) return false;

  return existingEvents.some(
    (e) =>
      e.playerId === candidate.playerId &&
      e.type === candidate.type &&
      e.videoTimestampSeconds != null &&
      Math.abs(e.videoTimestampSeconds - candidate.videoTimestampSeconds!) <= toleranceSeconds
  );
}
