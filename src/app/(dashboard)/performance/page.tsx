import Link from "next/link";
import { requireTeam } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { computeBoxScoreByPlayer, sumBoxScoreLines, emptyBoxScoreLine } from "@/lib/stats";
import { ShotCourt } from "@/components/shot-court";
import { isShotType } from "@/lib/stat-types";

export default async function PerformancePage() {
  const { team } = await requireTeam();

  const [matches, players, allEvents] = await Promise.all([
    prisma.match.findMany({ where: { teamId: team.id }, orderBy: { date: "asc" } }),
    prisma.player.findMany({ where: { teamId: team.id }, orderBy: { jerseyNumber: "asc" } }),
    prisma.statEvent.findMany({
      where: { match: { teamId: team.id } },
    }),
  ]);

  if (matches.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-navy">Performance</h1>
        <p className="mt-4 text-black/50">
          No matches yet.{" "}
          <Link href="/matches" className="text-brand-dark underline">
            Add a match
          </Link>{" "}
          to start building your season stats.
        </p>
      </div>
    );
  }

  const eventsByMatch = new Map<string, typeof allEvents>();
  for (const e of allEvents) {
    const arr = eventsByMatch.get(e.matchId) ?? [];
    arr.push(e);
    eventsByMatch.set(e.matchId, arr);
  }

  const perMatchTeamLines = matches.map((m) => {
    const events = eventsByMatch.get(m.id) ?? [];
    return sumBoxScoreLines(Object.values(computeBoxScoreByPlayer(events)));
  });

  const gamesAnalysed = matches.length;
  const avgPts =
    perMatchTeamLines.reduce((s, l) => s + l.pts, 0) / gamesAnalysed || 0;
  const avgAst =
    perMatchTeamLines.reduce((s, l) => s + l.ast, 0) / gamesAnalysed || 0;
  const avgReb =
    perMatchTeamLines.reduce((s, l) => s + l.reb, 0) / gamesAnalysed || 0;

  const decided = matches.filter((m) => m.teamScore !== null && m.opponentScore !== null);
  const wins = decided.filter((m) => m.teamScore! > m.opponentScore!).length;
  const winRate = decided.length > 0 ? (wins / decided.length) * 100 : 0;

  const seasonTeamLine = sumBoxScoreLines(perMatchTeamLines);

  const leaderboard = players
    .map((p) => {
      const events = allEvents.filter((e) => e.playerId === p.id);
      const line = events.length
        ? computeBoxScoreByPlayer(events)[p.id]
        : emptyBoxScoreLine(p.id);
      return { player: p, line };
    })
    .sort((a, b) => b.line.pts - a.line.pts);

  const shots = allEvents
    .filter((e) => isShotType(e.type) && e.shotX !== null && e.shotY !== null)
    .map((e) => ({ x: e.shotX as number, y: e.shotY as number, made: e.type.endsWith("MADE") }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Performance</h1>
      <p className="text-sm text-black/50">Aggregated stats across all completed games.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Games analysed", value: gamesAnalysed },
          { label: "Avg points", value: avgPts.toFixed(0) },
          { label: "Avg assists", value: avgAst.toFixed(0) },
          { label: "Avg rebounds", value: avgReb.toFixed(0) },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-black/5 bg-white p-4">
            <p className="text-xs uppercase text-black/40">{c.label}</p>
            <p className="mt-1 text-2xl font-bold text-navy">{c.value}</p>
          </div>
        ))}
        <div className="col-span-2 rounded-xl border border-black/5 bg-white p-4 sm:col-span-4 lg:col-span-1">
          <p className="text-xs uppercase text-black/40">Team win rate</p>
          <p className="mt-1 text-2xl font-bold text-navy">{winRate.toFixed(0)}%</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-black/5 bg-white p-4">
          <h3 className="text-sm font-semibold text-navy">Shot chart (season)</h3>
          <div className="mt-3">
            <ShotCourt shots={shots} />
          </div>
          <p className="mt-2 text-xs text-black/40">
            {seasonTeamLine.fgm}/{seasonTeamLine.fga} FG ·{" "}
            {seasonTeamLine.fgPct.toFixed(0)}%
          </p>
        </div>

        <div className="rounded-xl border border-black/5 bg-white p-4">
          <h3 className="text-sm font-semibold text-navy">Points leaderboard</h3>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-black/40">
                <th className="py-2">Player</th>
                <th className="py-2">#</th>
                <th className="py-2">PTS</th>
                <th className="py-2">FPTS</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map(({ player, line }) => (
                <tr key={player.id} className="border-t border-black/5">
                  <td className="py-2 font-medium text-navy">
                    {player.firstName} {player.lastName}
                  </td>
                  <td className="py-2 text-black/50">{player.jerseyNumber}</td>
                  <td className="py-2 font-semibold">{line.pts}</td>
                  <td className="py-2">{line.fpts.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
