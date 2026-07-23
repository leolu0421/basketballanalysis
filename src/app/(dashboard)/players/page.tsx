import { requireTeam } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { deletePlayerAction } from "@/lib/actions/team-actions";
import { AddPlayerForm } from "./add-player-form";

export default async function PlayersPage() {
  const { team } = await requireTeam();
  const players = await prisma.player.findMany({
    where: { teamId: team.id },
    orderBy: { jerseyNumber: "asc" },
    include: { _count: { select: { statEvents: true } } },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Playing Roster</h1>
          <p className="text-sm text-black/60">{players.length} players total</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
          <span className="text-black/50">Team code</span>
          <span className="font-mono font-semibold text-navy">{team.joinCode}</span>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-black/5 bg-white p-5">
        <h2 className="text-sm font-semibold text-navy">Add a player</h2>
        <AddPlayerForm />
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-black/5 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-black/40">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">First name</th>
              <th className="px-4 py-3">Last name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Logged events</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className="border-b border-black/5 last:border-0">
                <td className="px-4 py-3 font-semibold">#{p.jerseyNumber}</td>
                <td className="px-4 py-3">{p.firstName}</td>
                <td className="px-4 py-3">{p.lastName}</td>
                <td className="px-4 py-3 text-black/60">{p.email ?? "—"}</td>
                <td className="px-4 py-3 text-black/60">{p._count.statEvents}</td>
                <td className="px-4 py-3 text-right">
                  <form action={deletePlayerAction.bind(null, p.id)}>
                    <button
                      type="submit"
                      className="text-xs font-medium text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {players.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-black/40">
                  No players yet — add your first player above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
