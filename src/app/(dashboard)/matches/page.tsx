import Link from "next/link";
import { requireTeam } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { NewMatchForm } from "./new-match-form";

export default async function MatchesPage() {
  const { team } = await requireTeam();
  const matches = await prisma.match.findMany({
    where: { teamId: team.id },
    orderBy: { date: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Matches</h1>
      </div>

      <div className="mt-6 rounded-xl border border-black/5 bg-white p-5">
        <h2 className="text-sm font-semibold text-navy">Add a match</h2>
        <p className="mt-1 text-xs text-black/50">
          Paste a YouTube link to the game film — you can tag stats against it afterward.
        </p>
        <NewMatchForm />
      </div>

      <div className="mt-6 space-y-3">
        {matches.map((m) => {
          const hasScore = m.teamScore !== null && m.opponentScore !== null;
          const won = hasScore && m.teamScore! > m.opponentScore!;
          return (
            <Link
              key={m.id}
              href={`/matches/${m.id}`}
              className="flex items-center justify-between rounded-xl border border-black/5 bg-white px-5 py-4 transition hover:border-brand"
            >
              <div>
                <p className="text-xs uppercase tracking-wide text-black/40">
                  {m.date.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <p className="font-semibold text-navy">vs {m.opponentName}</p>
              </div>
              <div className="flex items-center gap-3">
                {hasScore && (
                  <span
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      won ? "bg-brand/20 text-brand-dark" : "bg-red-50 text-red-500"
                    }`}
                  >
                    {won ? "WIN" : "LOSS"}
                  </span>
                )}
                <span className="text-lg font-bold text-navy">
                  {hasScore ? `${m.teamScore} - ${m.opponentScore}` : "—"}
                </span>
              </div>
            </Link>
          );
        })}
        {matches.length === 0 && (
          <p className="rounded-xl border border-dashed border-black/10 bg-white px-5 py-10 text-center text-black/40">
            No matches yet — add your first one above.
          </p>
        )}
      </div>
    </div>
  );
}
