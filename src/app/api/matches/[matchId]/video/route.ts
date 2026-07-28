import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { videoStoragePathFor } from "@/lib/video-storage";

export const runtime = "nodejs";

/**
 * Confirmed in production: plain Readable.toWeb(createReadStream(...)) can
 * throw an uncaught "Invalid state: Controller is already closed"
 * (ERR_INVALID_STATE) when the client aborts mid-stream — e.g. a <video>
 * element cancelling one Range request because the user seeked to start
 * another. This wraps every controller operation defensively: if the
 * controller's already closed by the time we try to use it, that's a
 * benign race (client disconnected), not an error to propagate — just stop
 * reading and destroy the underlying file stream.
 */
function fileStreamToWebStream(nodeStream: ReadStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) => {
        try {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        } catch {
          nodeStream.destroy();
        }
      });
      nodeStream.on("end", () => {
        try {
          controller.close();
        } catch {
          // Already closed — client disconnected first, nothing to do.
        }
      });
      nodeStream.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          // Already closed — nothing to do.
        }
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
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
    const stream = fileStreamToWebStream(createReadStream(filePath));
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

  const stream = fileStreamToWebStream(createReadStream(filePath, { start, end }));

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
