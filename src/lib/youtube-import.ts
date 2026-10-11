import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
export const MAX_YOUTUBE_IMPORT = 50;

export function youtubeCollectionUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) return null;
    const list = url.searchParams.get("list");
    if (list && /^[a-zA-Z0-9_-]{10,100}$/.test(list)) {
      return `https://www.youtube.com/playlist?list=${list}`;
    }
    const channel = /^\/(channel\/[a-zA-Z0-9_-]+|@[a-zA-Z0-9_.-]+)(?:\/videos)?\/?$/.exec(url.pathname);
    return channel ? `https://www.youtube.com/${channel[1]}/videos` : null;
  } catch { return null; }
}

const collectionSchema = z.object({
  entries: z.array(z.object({
    id: z.string(), title: z.string().nullish(), availability: z.string().nullish(),
  }).nullable()),
});

export function parseYoutubeCollection(value: unknown) {
  const data = collectionSchema.parse(value);
  const seen = new Set<string>();
  return data.entries.flatMap((entry) => {
    if (!entry || !/^[a-zA-Z0-9_-]{11}$/.test(entry.id) || seen.has(entry.id) ||
        ["private", "needs_auth", "subscriber_only", "premium_only"].includes(entry.availability ?? "") ||
        ["[Private video]", "[Deleted video]"].includes(entry.title ?? "")) return [];
    seen.add(entry.id);
    return [{ videoId: entry.id, title: entry.title?.trim() || "Untitled video" }];
  }).slice(0, MAX_YOUTUBE_IMPORT);
}

export async function readYoutubeCollection(input: string) {
  const url = youtubeCollectionUrl(input);
  if (!url) throw new Error("Enter a YouTube playlist or channel URL.");
  const { stdout } = await execute("yt-dlp", [
    "--ignore-config", "--flat-playlist", "--dump-single-json", "--skip-download",
    "--playlist-end", String(MAX_YOUTUBE_IMPORT), "--socket-timeout", "15",
    "--retries", "1", "--", url,
  ], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  return parseYoutubeCollection(JSON.parse(stdout));
}
