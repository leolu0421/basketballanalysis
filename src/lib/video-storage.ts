import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";

/**
 * Creates every directory level one at a time instead of a single
 * mkdir(path, { recursive: true }) call. Confirmed in production that a
 * single recursive call can fail with ENOENT partway through on Railway's
 * Volume filesystem (a network-backed volume, not plain local disk) even
 * though the identical call works fine on a normal filesystem — this is
 * more defensive against whatever that filesystem's quirk is.
 */
async function ensureDirDeep(targetPath: string): Promise<void> {
  const isAbsolute = path.isAbsolute(targetPath);
  const segments = targetPath.split(path.sep).filter(Boolean);
  let current = isAbsolute ? path.sep : "";
  for (const segment of segments) {
    current = current ? path.join(current, segment) : segment;
    try {
      await mkdir(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

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
  await ensureDirDeep(dir);
  return dir;
}

/**
 * Chunked upload support: large videos are sent as many small requests
 * instead of one long-lived one, since a single multi-hundred-MB upload
 * over a slow connection can run long enough to get killed by a platform's
 * reverse-proxy timeout (confirmed in production — see README). Chunks for
 * one upload attempt live under a per-uploadId temp folder until
 * finalizeChunks concatenates them into the real video file.
 */
function chunkDirFor(matchId: string, uploadId: string): string {
  return path.join(/* turbopackIgnore: true */ VIDEO_STORAGE_DIR, matchId, "_uploads", uploadId);
}

export async function ensureChunkDir(matchId: string, uploadId: string): Promise<string> {
  const dir = chunkDirFor(matchId, uploadId);
  await ensureDirDeep(dir);
  return dir;
}

export function chunkPathFor(matchId: string, uploadId: string, index: number): string {
  return path.join(chunkDirFor(matchId, uploadId), `chunk_${String(index).padStart(6, "0")}`);
}

export async function finalizeChunks(
  matchId: string,
  uploadId: string,
  totalChunks: number,
  fileName: string
): Promise<void> {
  await ensureVideoDir(matchId);
  const destPath = videoStoragePathFor(matchId, fileName);
  const dir = chunkDirFor(matchId, uploadId);

  const writeStream = createWriteStream(destPath);
  // Tracked instead of using a fresh .on("error", reject) per chunk, which
  // would otherwise pile up one listener per chunk on this shared stream.
  let writeStreamError: Error | null = null;
  writeStream.on("error", (err) => {
    writeStreamError = err;
  });

  try {
    for (let i = 0; i < totalChunks; i++) {
      if (writeStreamError) throw writeStreamError;
      const chunkPath = chunkPathFor(matchId, uploadId, i);
      await new Promise<void>((resolve, reject) => {
        const readStream = createReadStream(chunkPath);
        readStream.once("error", reject);
        readStream.once("end", resolve);
        readStream.pipe(writeStream, { end: false });
      });
    }
    if (writeStreamError) throw writeStreamError;

    await new Promise<void>((resolve) => {
      writeStream.once("finish", resolve);
      writeStream.end();
    });
    if (writeStreamError) throw writeStreamError;
  } catch (err) {
    writeStream.destroy();
    throw err;
  }

  await rm(dir, { recursive: true, force: true });
}
