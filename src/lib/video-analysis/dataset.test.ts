import { describe, expect, it } from "vitest";
import { buildMatchDataset, type DatasetEvent } from "./dataset";

const event = (source: string, videoTimestampSeconds: number | null = 30): DatasetEvent => ({
  id: source, playerId: "p1", type: "DREB", quarter: 2, videoTimestampSeconds, source,
});
const match = {
  id: "m1", youtubeVideoId: "video1", videoFileName: null,
  players: [{ id: "p1", jerseyNumber: "2", firstName: "Harper", email: "private@example.com" }],
};

describe("match label export", () => {
  it("keeps independent manual truth separate from AI-confirmed and unknown events", () => {
    const result = buildMatchDataset({ ...match, events: [event("MANUAL"), event("AI_CONFIRMED"), event("UNKNOWN")] });
    expect(result.groundTruth.map((e) => e.source)).toEqual(["MANUAL"]);
    expect(result.reviewedSuggestions.map((e) => e.source)).toEqual(["AI_CONFIRMED"]);
    expect(result.unverified.map((e) => e.source)).toEqual(["UNKNOWN"]);
    expect(result.annotationCoverage).toBe("partial");
    expect(JSON.stringify(result)).not.toContain("Harper");
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });

  it("excludes unusable timestamps, unsupported labels and players outside the roster", () => {
    const result = buildMatchDataset({ ...match, events: [
      event("MANUAL", null), event("MANUAL", -1), event("MANUAL", NaN),
      { ...event("MANUAL"), playerId: "another-team" },
      { ...event("MANUAL"), type: "INVALID" }, event("MANUAL", 0),
    ] });
    expect(result.excludedEventCount).toBe(5);
    expect(result.groundTruth).toHaveLength(1);
    expect(result.groundTruth[0].timestampSeconds).toBe(0);
  });
});
