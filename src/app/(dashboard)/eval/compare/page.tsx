import Link from "next/link";
import { getAnalysisSummaryById } from "@/lib/actions/eval-actions";

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

function confidenceColorClass(value: number | null): string {
  if (value == null) return "text-black/40";
  if (value > 0.8) return "text-green-600";
  if (value >= 0.5) return "text-yellow-600";
  return "text-red-600";
}

type Summary = NonNullable<Awaited<ReturnType<typeof getAnalysisSummaryById>>>;

const ROWS: Array<{
  label: string;
  help: string;
  value: (s: Summary) => string;
  colorClass?: (s: Summary) => string;
}> = [
  { label: "Match", help: "The match this run analyzed.", value: (s) => `vs ${s.match.opponentName}` },
  { label: "Analyzed", help: "When this run completed.", value: (s) => s.analyzedAt.toLocaleString() },
  { label: "Commit", help: "Git commit the pipeline ran at.", value: (s) => (s.gitCommitHash ? s.gitCommitHash.slice(0, 7) : "—") },
  {
    label: "Score changes",
    help: "Number of detected scoreboard changes before filtering.",
    value: (s) => String(s.scoreChangesDetected),
  },
  {
    label: "Candidates",
    help: "Candidate scoring events after filtering — what's shown as \"Suggested moments.\"",
    value: (s) => String(s.suggestedMomentsGenerated),
  },
  {
    label: "Localization attempts",
    help: "Candidates for which localization actually ran (excludes implausible-delta skips and legacy-fallback candidates).",
    value: (s) => String(s.localizationAttempts),
  },
  {
    label: "Localization success",
    help: "Attempts where Claude vision found a real scoring frame.",
    value: (s) => String(s.localizationSuccess),
  },
  {
    label: "Localization fallback",
    help: "Attempts that ran fine but found no usable evidence — used the scoreboard-gap midpoint instead.",
    value: (s) => String(s.localizationFallback),
  },
  {
    label: "Localization failed",
    help: "Attempts that hit an actual error (ffmpeg failure/timeout, API error).",
    value: (s) => String(s.localizationFailed),
  },
  {
    label: "Average confidence",
    help: "Average confidence across localization attempts.",
    value: (s) => formatConfidence(s.averageLocalizationConfidence),
    colorClass: (s) => confidenceColorClass(s.averageLocalizationConfidence),
  },
  {
    label: "Processing time",
    help: "Total wall-clock time for the analysis job.",
    value: (s) => formatSeconds(s.totalProcessingSeconds),
  },
];

export default async function CompareEvalPage({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string | string[] }>;
}) {
  const params = await searchParams;
  const ids = params.compare ? (Array.isArray(params.compare) ? params.compare : [params.compare]) : [];

  if (ids.length !== 2) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-navy">Compare analysis runs</h1>
        <p className="mt-3 text-sm text-black/60">
          Pick exactly 2 runs to compare — go back and check 2 boxes.
        </p>
        <Link href="/eval" className="mt-3 inline-block text-sm text-navy hover:underline">
          ← Back to evaluation table
        </Link>
      </div>
    );
  }

  const [a, b] = await Promise.all([getAnalysisSummaryById(ids[0]), getAnalysisSummaryById(ids[1])]);

  if (!a || !b) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-navy">Compare analysis runs</h1>
        <p className="mt-3 text-sm text-black/60">One or both of those runs couldn&apos;t be found.</p>
        <Link href="/eval" className="mt-3 inline-block text-sm text-navy hover:underline">
          ← Back to evaluation table
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/eval" className="text-sm text-black/50 hover:underline">
        ← Back to evaluation table
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-navy">Compare analysis runs</h1>

      <div className="mt-4 overflow-x-auto rounded-xl border border-black/5 bg-white">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-black/40">
              <th className="px-4 py-2">Metric</th>
              <th className="px-4 py-2">Run A</th>
              <th className="px-4 py-2">Run B</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-black/5 last:border-0">
                <td className="px-4 py-2 font-medium text-navy" title={row.help}>
                  <span className="cursor-help underline decoration-dotted">{row.label}</span>
                </td>
                <td className={`px-4 py-2 ${row.colorClass ? row.colorClass(a) : "text-black/70"}`}>
                  {row.value(a)}
                </td>
                <td className={`px-4 py-2 ${row.colorClass ? row.colorClass(b) : "text-black/70"}`}>
                  {row.value(b)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
