import { requireTeam } from "@/lib/current-user";
import { TopNav } from "@/components/top-nav";
import { logoutAction } from "@/lib/actions/auth-actions";
import { Logo } from "@/components/logo";

// Top-nav layout — a single header (logo + team + horizontal nav row +
// avatar) with full-width content below it, no left sidebar. Previously a
// left sidebar + separate top bar; changed to look structurally distinct
// from that (unrelated to the AI pipeline — a coach-facing UI request).
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, team } = await requireTeam();
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-black/5 bg-white">
        <div className="flex h-16 items-center gap-6 px-6">
          <Logo />
          <div className="hidden sm:block">
            <p className="text-sm font-semibold leading-tight text-navy">
              {team.division ?? team.name}
            </p>
            {team.division && (
              <p className="text-xs leading-tight text-black/50">{team.name}</p>
            )}
          </div>
          <div className="flex-1" />
          <form action={logoutAction}>
            <button
              type="submit"
              title="Log out"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-bold text-white"
            >
              {initials}
            </button>
          </form>
        </div>
        <TopNav />
      </header>

      <main className="p-6">{children}</main>
    </div>
  );
}
