import { requireTeam } from "@/lib/current-user";
import { SidebarNav } from "@/components/sidebar-nav";
import { logoutAction } from "@/lib/actions/auth-actions";

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
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between bg-brand px-6">
        <span className="text-xl font-extrabold tracking-tight text-navy">
          superstat
        </span>
        <form action={logoutAction}>
          <button
            type="submit"
            title="Log out"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-bold text-white"
          >
            {initials}
          </button>
        </form>
      </header>

      <div className="flex flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-black/5 bg-white py-4">
          <div className="mb-4 px-4">
            <p className="text-sm font-semibold text-navy">
              {team.division ?? team.name}
            </p>
            {team.division && (
              <p className="text-xs text-black/50">{team.name}</p>
            )}
          </div>
          <SidebarNav />
        </aside>

        <main className="flex-1 bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
