import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { ensureVideoDir, videoStoragePathFor } from "@/lib/video-storage";

export const runtime = "nodejs";

/**
 * Uploads a match video directly (as an alternative to a YouTube link).
 * The client sends the raw file as the request body (not multipart form
 * data) so it can be streamed straight to disk without buffering the whole
 * file in memory — matters for 40-50 minute game videos that can be
 * hundreds of MB to a few GB.
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

  if (!request.body) {
    return NextResponse.json({ error: "No file data received" }, { status: 400 });
  }

  const rawName = request.nextUrl.searchParams.get("filename") || "video.mp4";
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");

  try {
    await ensureVideoDir(matchId);
    const destPath = videoStoragePathFor(matchId, safeName);

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

    await prisma.match.update({
      where: { id: matchId },
      data: { videoFileName: safeName, youtubeVideoId: null },
    });
  } catch (err) {
    console.error("Video upload failed:", err);
    return NextResponse.json({ error: "Upload failed. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Streams the uploaded video back for playback, with HTTP Range support so
 * the <video> element can seek without downloading the whole file first.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const { team } = await requireTeam();

  const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
  if (!match || !match.videoFileName) {
    return NextResponse.json({ error: "No video found" }, { status: 404 });
  }

  const filePath = videoStoragePathFor(matchId, match.videoFileName);
  let fileSize: number;
  try {
    fileSize = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "Video file missing on server" }, { status: 404 });
  }

  const range = request.headers.get("range");
  if (!range) {
    const stream = Readable.toWeb(
      createReadStream(filePath)
    ) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match_ = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match_?.[1] ? parseInt(match_[1], 10) : 0;
  const end = match_?.[2] ? parseInt(match_[2], 10) : fileSize - 1;
  const chunkSize = end - start + 1;

  const stream = Readable.toWeb(
    createReadStream(filePath, { start, end })
  ) as unknown as ReadableStream<Uint8Array>;

  return new NextResponse(stream, {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
    },
  });
}
