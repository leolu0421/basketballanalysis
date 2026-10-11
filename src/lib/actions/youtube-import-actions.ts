"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireTeam } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { readYoutubeCollection, MAX_YOUTUBE_IMPORT } from "@/lib/youtube-import";

export async function previewYoutubeImport(url: string) {
  const { team } = await requireTeam();
  if (typeof url !== "string" || url.length > 1000) return { error: "Enter a YouTube playlist or channel URL." };
  try {
    const videos = await readYoutubeCollection(url);
    const existing = await prisma.match.findMany({
      where: { teamId: team.id, youtubeVideoId: { in: videos.map((v) => v.videoId) } },
      select: { youtubeVideoId: true },
    });
    const ids = new Set(existing.map((m) => m.youtubeVideoId));
    return { videos: videos.map((v) => ({ ...v, alreadyImported: ids.has(v.videoId) })) };
  } catch (error) {
    console.error("YouTube collection preview failed:", error instanceof Error ? error.message : "unknown error");
    return { error: "Could not read YouTube videos. Check the link and visibility. The server needs yt-dlp and YouTube network access; YouTube may also block cloud requests." };
  }
}

const importSchema = z.array(z.object({
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
  opponentName: z.string().trim().min(1).max(200),
  date: z.iso.date(),
})).min(1).max(MAX_YOUTUBE_IMPORT);

export async function importYoutubeMatches(input: unknown) {
  const { team } = await requireTeam();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose at least one video and enter its opponent and match date." };
  const unique = [...new Map(parsed.data.map((v) => [v.videoId, v])).values()];
  try {
    const imported = await prisma.$transaction(async (tx) => {
      const existing = await tx.match.findMany({
        where: { teamId: team.id, youtubeVideoId: { in: unique.map((v) => v.videoId) } },
        select: { youtubeVideoId: true },
      });
      const ids = new Set(existing.map((m) => m.youtubeVideoId));
      const rows = unique.filter((v) => !ids.has(v.videoId));
      if (rows.length) await tx.match.createMany({ data: rows.map((v) => ({
        teamId: team.id, opponentName: v.opponentName,
        date: new Date(`${v.date}T00:00:00Z`), youtubeVideoId: v.videoId,
      })) });
      return rows.length;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePath("/matches");
    return { imported, skipped: unique.length - imported };
  } catch {
    return { error: "Import could not complete. Try again; existing videos will be skipped." };
  }
}
