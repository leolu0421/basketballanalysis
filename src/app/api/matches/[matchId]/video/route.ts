import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { videoStoragePathFor } from "@/lib/video-storage";

export const runtime = "nodejs";

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
