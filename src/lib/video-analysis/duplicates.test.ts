import { describe, expect, it } from "vitest";
import { isDuplicateEvent, type ExistingEvent } from "./duplicates";

describe("isDuplicateEvent", () => {
  const existing: ExistingEvent[] = [{ playerId: "p1", type: "FG2_MADE", videoTimestampSeconds: 100 }];

  it("blocks the same player/stat within the tolerance window", () => {
    expect(
      isDuplicateEvent(existing, { playerId: "p1", type: "FG2_MADE", videoTimestampSeconds: 101 })
    ).toBe(true);
    expect(
      isDuplicateEvent(existing, { playerId: "p1", type: "FG2_MADE", videoTimestampSeconds: 98 })
    ).toBe(true);
  });

  it("allows a separate event for the same player/stat outside the tolerance", () => {
    expect(
      isDuplicateEvent(existing, { playerId: "p1", type: "FG2_MADE", videoTimestampSeconds: 200 })
    ).toBe(false);
  });

  it("allows a different player at the same timestamp", () => {
    expect(
      isDuplicateEvent(existing, { playerId: "p2", type: "FG2_MADE", videoTimestampSeconds: 100 })
    ).toBe(false);
  });

  it("allows a different stat type for the same player at the same timestamp", () => {
    expect(
      isDuplicateEvent(existing, { playerId: "p1", type: "FG3_MADE", videoTimestampSeconds: 100 })
    ).toBe(false);
  });

  it("respects a custom tolerance", () => {
    expect(
      isDuplicateEvent(existing, { playerId: "p1", type: "FG2_MADE", videoTimestampSeconds: 105 }, 10)
    ).toBe(true);
    expect(
      isDuplicateEvent(existing, { playerId: "p1", type: "FG2_MADE", videoTimestampSeconds: 105 }, 2)
    ).toBe(false);
  });

  it("never flags a candidate with no timestamp as a duplicate", () => {
    expect(
      isDuplicateEvent(existing, { playerId: "p1", type: "FG2_MADE", videoTimestampSeconds: null })
    ).toBe(false);
  });
});
