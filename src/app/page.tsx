import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.teams.length === 0) redirect("/teams/new");
  redirect("/matches");
}
