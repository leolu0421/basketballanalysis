import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTeam: vi.fn(), readCollection: vi.fn(), findMany: vi.fn(), createMany: vi.fn(),
  transaction: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireTeam: mocks.requireTeam }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  match: { findMany: mocks.findMany }, $transaction: mocks.transaction,
} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/youtube-import", () => ({ readYoutubeCollection: mocks.readCollection, MAX_YOUTUBE_IMPORT: 50 }));
import { importYoutubeMatches, previewYoutubeImport } from "./youtube-import-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTeam.mockResolvedValue({ team: { id: "our-team" } });
  mocks.findMany.mockResolvedValue([{ youtubeVideoId: "abcdefghijk" }]);
  mocks.createMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (fn) => fn({ match: { findMany: mocks.findMany, createMany: mocks.createMany } }));
});

describe("YouTube match import", () => {
  it("deduplicates selections and skips existing team video IDs", async () => {
    const newVideo = { videoId: "ABCDEFGHIJK", opponentName: "Opponent", date: "2026-05-15" };
    const result = await importYoutubeMatches([
      { ...newVideo, videoId: "abcdefghijk" }, newVideo, newVideo,
    ]);
    expect(result).toEqual({ imported: 1, skipped: 1 });
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [{
      teamId: "our-team", opponentName: "Opponent", date: new Date("2026-05-15T00:00:00Z"), youtubeVideoId: "ABCDEFGHIJK",
    }] });
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("requires real match dates and opponents before any database write", async () => {
    expect(await importYoutubeMatches([{ videoId: "abcdefghijk", opponentName: "", date: "2026-02-30" }])).toHaveProperty("error");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("marks existing videos during read-only preview", async () => {
    mocks.readCollection.mockResolvedValue([{ videoId: "abcdefghijk", title: "Game" }]);
    const result = await previewYoutubeImport("https://www.youtube.com/playlist?list=PL1234567890");
    expect(result.videos?.[0].alreadyImported).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.findMany.mock.calls[0][0].where.teamId).toBe("our-team");
  });

  it("requires authentication before preview or import", async () => {
    mocks.requireTeam.mockRejectedValue(new Error("unauthenticated"));
    await expect(previewYoutubeImport("https://www.youtube.com/@team")).rejects.toThrow("unauthenticated");
    await expect(importYoutubeMatches([])).rejects.toThrow("unauthenticated");
    expect(mocks.readCollection).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
