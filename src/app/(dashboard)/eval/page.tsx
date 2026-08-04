import Link from "next/link";
import { getAnalysisSummaries } from "@/lib/actions/eval-actions";
import { setBenchmarkMatchAction } from "@/lib/actions/match-actions";

function formatSeconds(seconds: number | null) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatConfidence(value: number | null) {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export default async function EvalPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; benchmarkOnly?: string }>;
}) {
  const params = await searchParams;
  const sort = params.sort === "asc" ? "asc" : "desc";
  const benchmarkOnly = params.benchmarkOnly === "1";

  const summaries = await getAnalysisSummaries({ benchmarkOnly, sort });

  const otherSort = sort === "asc" ? "desc" : "asc";
  const benchmarkFilterHref = benchmarkOnly ? `?sort=${sort}` : `?sort=${sort}&benchmarkOnly=1`;

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold text-navy">AI Pipeline Evaluation</h1>
        <p className="mt-1 text-sm text-black/50">
          Internal QA — one row per completed video-analysis run. Not shown to coaches.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`?sort=${otherSort}${benchmarkOnly ? "&benchmarkOnly=1" : ""}`}
          className="rounded-lg border border-black/10 bg-white px-3 py-1.5 font-medium text-navy hover:border-brand"
        >
          Sort by date: {sort === "desc" ? "Newest first" : "Oldest first"}
        </Link>
        <Link
          href={benchmarkFilterHref}
          className={`rounded-lg border px-3 py-1.5 font-medium ${
            benchmarkOnly
              ? "border-brand bg-brand/10 text-navy"
              : "border-black/10 bg-white text-navy hover:border-brand"
          }`}
        >
          {benchmarkOnly ? "★ Benchmark matches only" : "Show benchmark matches only"}
        </Link>
      </div>

      {/* Native GET form — checkboxes below reference this by id via the
          `form` attribute, so no client-side JS is needed to build a
          compare link out of however many rows get checked. */}
      <form id="compare-form" action="/eval/compare" method="GET" className="mt-3">
        <button
          type="submit"
          className="rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold text-white"
        >
          Compare selected (pick 2)
        </button>
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-black/5 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-black/40">
              <th className="px-3 py-2"> </th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Analyzed</th>
              <th className="px-3 py-2">Commit</th>
              <th className="px-3 py-2 text-right">Score changes</th>
              <th className="px-3 py-2 text-right">Candidates</th>
              <th className="px-3 py-2 text-right">Localized</th>
              <th className="px-3 py-2 text-right">Fallback</th>
              <th className="px-3 py-2 text-right">Avg. confidence</th>
              <th className="px-3 py-2 text-right">Processing time</th>
              <th className="px-3 py-2">Benchmark</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.02]">
                <td className="px-3 py-2">
                  <input type="checkbox" name="compare" value={s.id} form="compare-form" />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/matches/${s.match.id}`} className="font-medium text-navy hover:underline">
                    vs {s.match.opponentName}
                  </Link>
                </td>
                <td className="px-3 py-2 text-black/60">
                  {s.analyzedAt.toLocaleString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-black/50">
                  {s.gitCommitHash ? s.gitCommitHash.slice(0, 7) : "—"}
                </td>
                <td className="px-3 py-2 text-right">{s.scoreChangesDetected}</td>
                <td className="px-3 py-2 text-right">{s.suggestedMomentsGenerated}</td>
                <td className="px-3 py-2 text-right">{s.localizedSuccessfully}</td>
                <td className="px-3 py-2 text-right">{s.localizationFallbackCount}</td>
                <td className="px-3 py-2 text-right">{formatConfidence(s.averageLocalizationConfidence)}</td>
                <td className="px-3 py-2 text-right">{formatSeconds(s.totalProcessingSeconds)}</td>
                <td className="px-3 py-2">
                  <form action={setBenchmarkMatchAction.bind(null, s.match.id, !s.match.isBenchmark)}>
                    <button
                      type="submit"
                      className={`rounded px-2 py-1 text-xs font-semibold ${
                        s.match.isBenchmark
                          ? "bg-brand/20 text-brand-dark"
                          : "border border-black/10 text-black/50 hover:border-brand"
                      }`}
                    >
                      {s.match.isBenchmark ? "★ Benchmark" : "Mark benchmark"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {summaries.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-black/40">
                  No analysis runs recorded yet{benchmarkOnly ? " for benchmark matches" : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
