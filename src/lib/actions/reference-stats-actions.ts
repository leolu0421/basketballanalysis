"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/current-user";

export type ReferenceStatsActionState = { error?: string } | undefined;

const lineSchema = z.object({
  playerId: z.string().min(1),
  fg2Made: z.coerce.number().int().min(0),
  fg3Made: z.coerce.number().int().min(0),
  ftMade: z.coerce.number().int().min(0),
  fouls: z.coerce.number().int().min(0),
});

const inputSchema = z.array(lineSchema);

export async function saveReferenceStatsAction(
  matchId: string,
  lines: z.infer<typeof lineSchema>[]
): Promise<ReferenceStatsActionState> {
  const { team } = await requireTeam();

  const parsed = inputSchema.safeParse(lines);
  if (!parsed.success) {
    return { error: "Enter valid whole numbers for each stat." };
  }

  try {
    const match = await prisma.match.findFirst({ where: { id: matchId, teamId: team.id } });
    if (!match) return { error: "Match not found" };

    const playerIds = parsed.data.map((l) => l.playerId);
    const validPlayers = await prisma.player.findMany({
      where: { id: { in: playerIds }, teamId: team.id },
    });
    const validIds = new Set(validPlayers.map((p) => p.id));

    await prisma.$transaction(
      parsed.data
        .filter((l) => validIds.has(l.playerId))
        .map((l) =>
          prisma.referenceStatLine.upsert({
            where: { matchId_playerId: { matchId, playerId: l.playerId } },
            create: {
              matchId,
              playerId: l.playerId,
              fg2Made: l.fg2Made,
              fg3Made: l.fg3Made,
              ftMade: l.ftMade,
              fouls: l.fouls,
            },
            update: {
              fg2Made: l.fg2Made,
              fg3Made: l.fg3Made,
              ftMade: l.ftMade,
              fouls: l.fouls,
            },
          })
        )
    );
  } catch (err) {
    console.error("saveReferenceStatsAction failed:", err);
    return { error: "Something went wrong. Try again in a moment." };
  }

  revalidatePath("/stats");
  return undefined;
}
