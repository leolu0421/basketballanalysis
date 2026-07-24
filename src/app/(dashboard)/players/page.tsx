import { requireTeam } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { AddPlayerForm } from "./add-player-form";
import { EditPlayerRow } from "./edit-player-row";

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
              <EditPlayerRow key={p.id} player={p} />
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
