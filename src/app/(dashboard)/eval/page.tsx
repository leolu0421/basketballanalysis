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

// Green > 80%, Yellow 50-80%, Red < 50% — thresholds per the coach's spec.
function confidenceColorClass(value: number | null): string {
  if (value == null) return "text-black/40";
  if (value > 0.8) return "text-green-600";
  if (value >= 0.5) return "text-yellow-600";
  return "text-red-600";
}

const COLUMNS: { label: string; help: string; align?: "right" }[] = [
  {
    label: "Score changes",
    help: "Number of detected scoreboard changes before filtering (includes readings later discarded as unconfirmed one-off misreads).",
  },
  {
    label: "Candidates",
    help: "Candidate scoring events after the two-read confirmation filter — exactly what's shown as \"Suggested moments\" in the coach-facing UI.",
    align: "right",
  },
  {
    label: "Loc. attempts",
    help: "Candidates for which event localization actually ran. Excludes candidates skipped for an implausible score delta, and any routed to the legacy wide-frame fallback after an earlier tracking failure — those two together make up (Candidates − Loc. attempts).",
    align: "right",
  },
  {
    label: "Loc. success",
    help: "Localization attempts where Claude vision identified a real scoring frame.",
    align: "right",
  },
  {
    label: "Loc. fallback",
    help: "Localization attempts that ran to completion but found no usable evidence (not an error) — extraction produced zero frames, or Claude found nothing clear enough. Falls back to the scoreboard-gap midpoint.",
    align: "right",
  },
  {
    label: "Loc. failed",
    help: "Localization attempts that hit an actual error (ffmpeg failure/timeout, an API error) — distinct from Fallback, which is an expected \"tried, found nothing\" outcome, not a bug.",
    align: "right",
  },
  {
    label: "Avg. confidence",
    help: "Average confidence across localization attempts (successful ones report a real confidence; fallback/failed attempts count as 0). Green > 80%, yellow 50-80%, red < 50%.",
    align: "right",
  },
  {
    label: "Processing time",
    help: "Total wall-clock time for the analysis job, from creation to completion.",
    align: "right",
  },
];

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
          Internal QA — one row per completed video-analysis run. Not shown to coaches. Hover a column
          header for what it measures; click a row to open that match.
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
        <button type="submit" className="rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold text-white">
          Compare selected (pick 2)
        </button>
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-black/5 bg-white">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-black/40">
              <th className="px-3 py-2"> </th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Analyzed</th>
              <th className="px-3 py-2">Commit</th>
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  title={col.help}
                  className={`cursor-help px-3 py-2 underline decoration-dotted ${
                    col.align === "right" ? "text-right" : ""
                  }`}
                >
                  {col.label}
                </th>
              ))}
              <th className="px-3 py-2">Benchmark</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.02]">
                <td className="px-3 py-2">
                  <input type="checkbox" name="compare" value={s.id} form="compare-form" />
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 font-medium text-navy hover:underline">
                    vs {s.match.opponentName}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 text-black/60">
                    {s.analyzedAt.toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 font-mono text-xs text-black/50">
                    {s.gitCommitHash ? s.gitCommitHash.slice(0, 7) : "—"}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2">
                    {s.scoreChangesDetected}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 text-right">
                    {s.suggestedMomentsGenerated}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 text-right">
                    {s.localizationAttempts}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 text-right">
                    {s.localizationSuccess}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 text-right">
                    {s.localizationFallback}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 text-right">
                    {s.localizationFailed}
                  </Link>
                </td>
                <td className="p-0">
                  <Link
                    href={`/matches/${s.match.id}`}
                    className={`block px-3 py-2 text-right font-semibold ${confidenceColorClass(
                      s.averageLocalizationConfidence
                    )}`}
                  >
                    {formatConfidence(s.averageLocalizationConfidence)}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={`/matches/${s.match.id}`} className="block px-3 py-2 text-right">
                    {formatSeconds(s.totalProcessingSeconds)}
                  </Link>
                </td>
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
                <td colSpan={13} className="px-3 py-10 text-center text-black/40">
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
