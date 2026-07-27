import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { ensureChunkDir, chunkPathFor } from "@/lib/video-storage";

export const runtime = "nodejs";

const UPLOAD_ID_PATTERN = /^[a-zA-Z0-9-]+$/;

/**
 * Receives one chunk of a large video upload (see upload-video-form.tsx —
 * files are split client-side so no single request runs long enough to hit
 * a platform's reverse-proxy timeout, which killed single-shot uploads of
 * large files in production). Streams straight to disk, same low-memory
 * approach as the non-chunked route.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const { team } = await requireTeam();

  const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const uploadId = request.nextUrl.searchParams.get("uploadId");
  const indexParam = request.nextUrl.searchParams.get("index");
  if (!uploadId || !UPLOAD_ID_PATTERN.test(uploadId)) {
    return NextResponse.json({ error: "Invalid uploadId" }, { status: 400 });
  }
  const index = indexParam !== null ? parseInt(indexParam, 10) : NaN;
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "Invalid chunk index" }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "No chunk data received" }, { status: 400 });
  }

  try {
    await ensureChunkDir(matchId, uploadId);
    const destPath = chunkPathFor(matchId, uploadId, index);

    await new Promise<void>((resolve, reject) => {
      const writeStream = createWriteStream(destPath);
      const nodeReadable = Readable.fromWeb(
        request.body as import("stream/web").ReadableStream<Uint8Array>
      );
      nodeReadable.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", () => resolve());
      nodeReadable.pipe(writeStream);
    });
  } catch (err) {
    console.error(`Chunk upload failed (matchId=${matchId}, uploadId=${uploadId}, index=${index}):`, err);
    return NextResponse.json({ error: "Chunk upload failed. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
