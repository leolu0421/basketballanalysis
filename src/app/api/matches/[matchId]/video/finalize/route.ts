import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";
import { finalizeChunks } from "@/lib/video-storage";

export const runtime = "nodejs";

const bodySchema = z.object({
  uploadId: z.string().regex(/^[a-zA-Z0-9-]+$/),
  totalChunks: z.number().int().min(1),
  filename: z.string().min(1),
});

/**
 * Concatenates all chunks from a completed chunked upload (see the
 * chunk/route.ts sibling) into the real video file, then links it to the
 * match — same effect as the old single-shot upload, just assembled from
 * pieces instead of one long request.
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

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const safeName = parsed.data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");

  try {
    await finalizeChunks(matchId, parsed.data.uploadId, parsed.data.totalChunks, safeName);
    await prisma.match.update({
      where: { id: matchId },
      data: { videoFileName: safeName, youtubeVideoId: null },
    });
  } catch (err) {
    console.error("Video finalize failed:", err);
    return NextResponse.json(
      { error: "Failed to assemble the uploaded video. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
