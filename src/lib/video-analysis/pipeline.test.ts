import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ScoreCandidate } from "./candidates";

/**
 * Regression test for a real production bug: a shared trackingAvailable
 * flag in guessCandidatePlayers used to permanently disable
 * localization/tracking for every remaining candidate the moment any ONE
 * candidate's tracking step threw. These tests prove candidates are fully
 * isolated — a failure on one candidate must not affect any other's chance
 * at localization/tracking. Mocks child_process/fs/vision so the actual
 * exported guessCandidatePlayers control flow is under test, not a stand-in.
 */

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async () => "/tmp/fake"),
  mkdir: vi.fn(async () => undefined),
  readdir: vi.fn(async () => ["frame_00001.jpg"]),
  readFile: vi.fn(async () => JSON.stringify({ tracks: [{ trackId: 1, crops: ["/tmp/crop1.jpg"] }] })),
  rm: vi.fn(async () => undefined),
  access: vi.fn(async () => {
    throw new Error("no trained jersey model in this test");
  }),
}));

const guessCandidateFromTracksMock = vi.fn();
const localizeScoringMomentMock = vi.fn();
vi.mock("./vision", () => ({
  readScoreboardBatch: vi.fn(),
  guessCandidateStatsBatch: vi.fn(async () => []),
  guessCandidateFromTracks: (...args: unknown[]) => guessCandidateFromTracksMock(...args),
  localizeScoringMoment: (...args: unknown[]) => localizeScoringMomentMock(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    videoAnalysisJob: { update: vi.fn(async () => ({})) },
  },
}));

function makeFakeChild() {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.kill = vi.fn();
  queueMicrotask(() => emitter.emit("close", 0));
  return emitter;
}

const SUCCESSFUL_LOCALIZATION = {
  localizedTimestampSeconds: 10,
  confidence: 0.8,
  reason: "test fixture",
  method: "vision" as const,
  shooterVisible: true,
  topCandidates: [{ timestampSeconds: 10, confidence: 0.8 }],
};

const roster = [{ id: "p1", jerseyNumber: "7", firstName: "Test", lastName: "Player" }];

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => makeFakeChild());
  guessCandidateFromTracksMock.mockReset();
  localizeScoringMomentMock.mockReset();
  localizeScoringMomentMock.mockResolvedValue(SUCCESSFUL_LOCALIZATION);
});

function candidate(previousScoreText: string, scoreText: string, start: number): ScoreCandidate {
  return {
    videoTimestampSeconds: start + 5,
    previousScoreText,
    scoreText,
    gapStartSeconds: start,
    gapEndSeconds: start + 10,
  };
}

describe("guessCandidatePlayers candidate isolation", () => {
  it("a tracking failure on candidate 0 does not prevent candidate 1 from being processed", async () => {
    const { guessCandidatePlayers } = await import("./pipeline");

    guessCandidateFromTracksMock
      .mockRejectedValueOnce(new Error("simulated tracking failure for candidate 0"))
      .mockResolvedValueOnce({ trackId: 1, jerseyNumber: "7", statType: "FG2_MADE" });

    const { results, localizations } = await guessCandidatePlayers(
      "job1",
      [candidate("0-0", "2-0", 5), candidate("2-0", "4-0", 35)],
      "/fake/video.mp4",
      "/fake/workdir",
      "/fake/frames",
      ["frame_00001.jpg"],
      roster
    );

    // Candidate 0 genuinely failed at the tracking step, so it has no guess.
    expect(results[0]).toBeUndefined();

    // The old bug: this would be called once, and candidate 1 would never
    // even attempt tracking once trackingAvailable flipped false.
    expect(guessCandidateFromTracksMock).toHaveBeenCalledTimes(2);
    expect(results[1]).toEqual({ jerseyNumber: "7", statType: "FG2_MADE", playerId: "p1" });

    // Both candidates got their own independent localization attempt.
    expect(localizations[0]).toBeDefined();
    expect(localizations[1]).toBeDefined();
  });

  it("a failure in the middle candidate (of 3) does not stop the one after it either", async () => {
    const { guessCandidatePlayers } = await import("./pipeline");

    guessCandidateFromTracksMock
      .mockResolvedValueOnce({ trackId: 1, jerseyNumber: "7", statType: "FG2_MADE" })
      .mockRejectedValueOnce(new Error("simulated tracking failure for candidate 1"))
      .mockResolvedValueOnce({ trackId: 1, jerseyNumber: "7", statType: "FG3_MADE" });

    const { results } = await guessCandidatePlayers(
      "job1",
      [candidate("0-0", "2-0", 5), candidate("2-0", "4-0", 35), candidate("4-0", "7-0", 65)],
      "/fake/video.mp4",
      "/fake/workdir",
      "/fake/frames",
      ["frame_00001.jpg"],
      roster
    );

    expect(guessCandidateFromTracksMock).toHaveBeenCalledTimes(3);
    expect(results[0]).toEqual({ jerseyNumber: "7", statType: "FG2_MADE", playerId: "p1" });
    expect(results[1]).toBeUndefined();
    expect(results[2]).toEqual({ jerseyNumber: "7", statType: "FG3_MADE", playerId: "p1" });
  });
});
