"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam, requireUser } from "@/lib/current-user";

function randomJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const teamSchema = z.object({
  name: z.string().min(1, "Team name is required"),
  division: z.string().optional(),
});

export type TeamActionState = { error?: string } | undefined;

export async function createTeamAction(
  _prevState: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const user = await requireUser();

  const parsed = teamSchema.safeParse({
    name: formData.get("name"),
    division: formData.get("division") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let joinCode = randomJoinCode();
  while (await prisma.team.findUnique({ where: { joinCode } })) {
    joinCode = randomJoinCode();
  }

  await prisma.team.create({
    data: {
      name: parsed.data.name,
      division: parsed.data.division,
      joinCode,
      ownerId: user.id,
    },
  });

  redirect("/matches");
}

const playerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  jerseyNumber: z.string().min(1, "Jersey number is required"),
  email: z.string().email().optional().or(z.literal("")),
});

export async function addPlayerAction(
  _prevState: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const { team } = await requireTeam();

  const parsed = playerSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    jerseyNumber: formData.get("jerseyNumber"),
    email: formData.get("email") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await prisma.player.create({
    data: {
      teamId: team.id,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      jerseyNumber: parsed.data.jerseyNumber,
      email: parsed.data.email || null,
    },
  });

  revalidatePath("/players");
  return undefined;
}

export async function deletePlayerAction(playerId: string) {
  const { team } = await requireTeam();
  await prisma.player.deleteMany({ where: { id: playerId, teamId: team.id } });
  revalidatePath("/players");
}
