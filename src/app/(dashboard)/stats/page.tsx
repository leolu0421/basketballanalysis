import Link from "next/link";
import { requireTeam } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  computeBoxScoreByPlayer,
  sumBoxScoreLines,
  emptyBoxScoreLine,
} from "@/lib/stats";
import { ShotCourt } from "@/components/shot-court";
import { isShotType } from "@/lib/stat-types";
import { MatchSelector } from "./match-selector";

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ matchId?: string; tab?: string }>;
}) {
  const { team } = await requireTeam();
  const { matchId, tab = "team" } = await searchParams;

  const matches = await prisma.match.findMany({
    where: { teamId: team.id },
    orderBy: { date: "desc" },
  });

  if (matches.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-navy">Stats</h1>
        <p className="mt-4 text-black/50">
          No matches yet.{" "}
          <Link href="/matches" className="text-brand-dark underline">
            Add a match
          </Link>{" "}
          and tag some stats to see them here.
        </p>
      </div>
    );
  }

  const activeMatch = matches.find((m) => m.id === matchId) ?? matches[0];

  const [players, events] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, orderBy: { jerseyNumber: "asc" } }),
    prisma.statEvent.findMany({ where: { matchId: activeMatch.id } }),
  ]);

  const boxByPlayer = computeBoxScoreByPlayer(events);
  const lines = players.map((p) => boxByPlayer[p.id] ?? emptyBoxScoreLine(p.id));
  const team_ = sumBoxScoreLines(lines);
  const bestPlayer = players
    .map((p) => ({ player: p, line: boxByPlayer[p.id] ?? emptyBoxScoreLine(p.id) }))
    .sort((a, b) => b.line.eff - a.line.eff)[0];

  const shots = events
    .filter((e) => isShotType(e.type) && e.shotX !== null && e.shotY !== null)
    .map((e) => ({ x: e.shotX as number, y: e.shotY as number, made: e.type.endsWith("MADE") }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Stats</h1>
          <p className="text-sm text-black/50">An overview of your team&apos;s performance.</p>
        </div>
        <MatchSelector
          matches={matches}
          activeMatchId={activeMatch.id}
          tab={tab}
          basePath="/stats"
        />
      </div>

      <div className="mt-4 flex gap-1 border-b border-black/10">
        {[
          { key: "team", label: "Team Stats" },
          { key: "player", label: "Player Stats" },
          { key: "opposition", label: "Opposition Stats" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/stats?matchId=${activeMatch.id}&tab=${t.key}`}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-navy text-navy"
                : "border-transparent text-black/40 hover:text-black/70"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "opposition" && (
        <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-black/5 bg-white py-16 text-center">
          <h3 className="font-semibold text-navy">Opposition Stats Locked</h3>
          <p className="mt-1 max-w-sm text-sm text-black/50">
            See your opponent&apos;s shooting, rebounds, turnovers and more by enabling
            opposition stats on your next match upload.
          </p>
          <button
            disabled
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-navy opacity-60"
          >
            Get Opposition Stats →
          </button>
        </div>
      )}

      {tab === "team" && (
        <div className="mt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-black/5 bg-white p-4">
              <p className="text-xs uppercase text-black/40">Final score</p>
              <p className="mt-1 text-2xl font-bold text-navy">
                {activeMatch.teamScore ?? "–"} - {activeMatch.opponentScore ?? "–"}
              </p>
            </div>
            <div className="rounded-xl border border-black/5 bg-white p-4">
              <p className="text-xs uppercase text-black/40">Turnovers</p>
              <p className="mt-1 text-2xl font-bold text-navy">{team_.tov}</p>
            </div>
            <div className="rounded-xl border border-black/5 bg-white p-4">
              <p className="text-xs uppercase text-black/40">Best player</p>
              <p className="mt-1 text-2xl font-bold text-navy">
                {bestPlayer && bestPlayer.line.eff > 0
                  ? `${bestPlayer.player.firstName} ${bestPlayer.player.lastName}`
                  : "–"}
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-black/5 bg-white p-4">
              <h3 className="text-sm font-semibold text-navy">Shooting splits</h3>
              <div className="mt-4 space-y-4">
                {[
                  { label: "2PT", made: team_.fg2m, att: team_.fg2a, pct: team_.fg2Pct },
                  { label: "3PT", made: team_.fg3m, att: team_.fg3a, pct: team_.fg3Pct },
                  { label: "FT", made: team_.ftm, att: team_.fta, pct: team_.ftPct },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="w-10 text-sm font-medium text-black/60">{row.label}</span>
                    <div className="mx-3 h-2 flex-1 rounded-full bg-black/5">
                      <div
                        className="h-2 rounded-full bg-brand"
                        style={{ width: `${Math.min(100, row.pct)}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-sm text-black/50">
                      {row.made}-{row.att} ({fmtPct(row.pct)})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-black/5 bg-white p-4">
              <h3 className="text-sm font-semibold text-navy">Shot chart</h3>
              <div className="mt-3">
                <ShotCourt shots={shots} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "player" && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-black/5 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-black/40">
                <th className="px-3 py-3">Player</th>
                <th className="px-3 py-3">#</th>
                <th className="px-3 py-3">PTS</th>
                <th className="px-3 py-3">OREB</th>
                <th className="px-3 py-3">DREB</th>
                <th className="px-3 py-3">REB</th>
                <th className="px-3 py-3">AST</th>
                <th className="px-3 py-3">STL</th>
                <th className="px-3 py-3">BLK</th>
                <th className="px-3 py-3">TO</th>
                <th className="px-3 py-3">FG</th>
                <th className="px-3 py-3">FG%</th>
                <th className="px-3 py-3">3PT</th>
                <th className="px-3 py-3">3P%</th>
                <th className="px-3 py-3">FT</th>
                <th className="px-3 py-3">FT%</th>
                <th className="px-3 py-3">PF</th>
                <th className="px-3 py-3">FPTS</th>
                <th className="px-3 py-3">EFF</th>
                <th className="px-3 py-3">TS%</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const l = boxByPlayer[p.id] ?? emptyBoxScoreLine(p.id);
                return (
                  <tr key={p.id} className="border-b border-black/5 last:border-0">
                    <td className="px-3 py-2 font-medium text-navy">
                      {p.firstName} {p.lastName}
                    </td>
                    <td className="px-3 py-2">{p.jerseyNumber}</td>
                    <td className="px-3 py-2 font-semibold">{l.pts}</td>
                    <td className="px-3 py-2">{l.oreb}</td>
                    <td className="px-3 py-2">{l.dreb}</td>
                    <td className="px-3 py-2">{l.reb}</td>
                    <td className="px-3 py-2">{l.ast}</td>
                    <td className="px-3 py-2">{l.stl}</td>
                    <td className="px-3 py-2">{l.blk}</td>
                    <td className="px-3 py-2">{l.tov}</td>
                    <td className="px-3 py-2">
                      {l.fgm}-{l.fga}
                    </td>
                    <td className="px-3 py-2">{fmtPct(l.fgPct)}</td>
                    <td className="px-3 py-2">
                      {l.fg3m}-{l.fg3a}
                    </td>
                    <td className="px-3 py-2">{fmtPct(l.fg3Pct)}</td>
                    <td className="px-3 py-2">
                      {l.ftm}-{l.fta}
                    </td>
                    <td className="px-3 py-2">{fmtPct(l.ftPct)}</td>
                    <td className="px-3 py-2">{l.pf}</td>
                    <td className="px-3 py-2 font-semibold">{l.fpts.toFixed(1)}</td>
                    <td className="px-3 py-2">{l.eff.toFixed(0)}</td>
                    <td className="px-3 py-2">{fmtPct(l.tsPct)}</td>
                  </tr>
                );
              })}
              <tr className="bg-black/5 font-semibold text-navy">
                <td className="px-3 py-2" colSpan={2}>
                  TEAM
                </td>
                <td className="px-3 py-2">{team_.pts}</td>
                <td className="px-3 py-2">{team_.oreb}</td>
                <td className="px-3 py-2">{team_.dreb}</td>
                <td className="px-3 py-2">{team_.reb}</td>
                <td className="px-3 py-2">{team_.ast}</td>
                <td className="px-3 py-2">{team_.stl}</td>
                <td className="px-3 py-2">{team_.blk}</td>
                <td className="px-3 py-2">{team_.tov}</td>
                <td className="px-3 py-2">
                  {team_.fgm}-{team_.fga}
                </td>
                <td className="px-3 py-2">{fmtPct(team_.fgPct)}</td>
                <td className="px-3 py-2">
                  {team_.fg3m}-{team_.fg3a}
                </td>
                <td className="px-3 py-2">{fmtPct(team_.fg3Pct)}</td>
                <td className="px-3 py-2">
                  {team_.ftm}-{team_.fta}
                </td>
                <td className="px-3 py-2">{fmtPct(team_.ftPct)}</td>
                <td className="px-3 py-2">{team_.pf}</td>
                <td className="px-3 py-2">{team_.fpts.toFixed(1)}</td>
                <td className="px-3 py-2">{team_.eff.toFixed(0)}</td>
                <td className="px-3 py-2">{fmtPct(team_.tsPct)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
