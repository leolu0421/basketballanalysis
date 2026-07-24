import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

export async function getCurrentUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { teams: { orderBy: { createdAt: "asc" } } },
    });
    return user;
  } catch (err) {
    console.error("getCurrentUser failed:", err);
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireTeam() {
  const user = await requireUser();
  if (user.teams.length === 0) redirect("/teams/new");
  return { user, team: user.teams[0] };
}
