import path from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Where uploaded match videos live on disk. On Railway this should point at
 * a mounted Volume (see README's "Direct video upload" section) so files
 * survive redeploys — without a volume, this still works but files vanish
 * on every deploy since the container filesystem is otherwise ephemeral.
 */
const VIDEO_STORAGE_DIR =
  process.env.VIDEO_STORAGE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".video-storage");

export function videoStoragePathFor(matchId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(/* turbopackIgnore: true */ VIDEO_STORAGE_DIR, matchId, safeName);
}

export async function ensureVideoDir(matchId: string): Promise<string> {
  const dir = path.join(/* turbopackIgnore: true */ VIDEO_STORAGE_DIR, matchId);
  await mkdir(dir, { recursive: true });
  return dir;
}
