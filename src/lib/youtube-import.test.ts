import { describe, expect, it } from "vitest";
import { extractYoutubeId } from "./youtube";
import { parseYoutubeCollection, youtubeCollectionUrl } from "./youtube-import";

describe("YouTube collection links", () => {
  it("normalizes playlists and channels without forwarding arbitrary URL parameters", () => {
    expect(youtubeCollectionUrl("https://www.youtube.com/watch?v=abcdefghijk&list=PL1234567890"))
      .toBe("https://www.youtube.com/playlist?list=PL1234567890");
    expect(youtubeCollectionUrl("https://youtube.com/@our.team/videos"))
      .toBe("https://www.youtube.com/@our.team/videos");
  });
  it("rejects arbitrary hosts, local URLs and credentials", () => {
    for (const url of ["https://youtube.com.evil.test/@team", "http://youtube.com/@team", "https://127.0.0.1/playlist?list=PL1234567890", "https://user:pass@youtube.com/@team", "https://youtube.com:444/@team"])
      expect(youtubeCollectionUrl(url)).toBeNull();
    expect(extractYoutubeId("https://fakeyoutube.com/watch?v=abcdefghijk")).toBeNull();
    expect(extractYoutubeId("https://youtu.be/invalid")).toBeNull();
  });
  it("filters unavailable and duplicate videos without assuming upload dates are match dates", () => {
    const result = parseYoutubeCollection({ entries: [
      { id: "abcdefghijk", title: "Game 1", upload_date: "20260515" },
      { id: "abcdefghijk", title: "Duplicate" },
      { id: "ABCDEFGHIJK", title: "[Private video]" }, null,
      { id: "12345678901", title: "Private", availability: "private" },
    ] });
    expect(result).toEqual([{ videoId: "abcdefghijk", title: "Game 1" }]);
  });
});
