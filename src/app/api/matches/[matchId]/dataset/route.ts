import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { buildMatchDataset } from "@/lib/video-analysis/dataset";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { matchId } = await params;
  const match = await prisma.match.findFirst({
    where: { id: matchId, team: { ownerId: user.id } },
    include: {
      team: { select: { players: { select: { id: true, jerseyNumber: true } } } },
      statEvents: { orderBy: { videoTimestampSeconds: "asc" } },
    },
  });
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  return NextResponse.json(buildMatchDataset({ ...match, events: match.statEvents, players: match.team.players }), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="match-${match.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-labels.json"`,
    },
  });
}
