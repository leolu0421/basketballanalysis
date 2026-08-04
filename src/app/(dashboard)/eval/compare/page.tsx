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

const ROWS: Array<{
  label: string;
  value: (s: NonNullable<Awaited<ReturnType<typeof getAnalysisSummaryById>>>) => string;
}> = [
  { label: "Match", value: (s) => `vs ${s.match.opponentName}` },
  { label: "Analyzed", value: (s) => s.analyzedAt.toLocaleString() },
  { label: "Commit", value: (s) => (s.gitCommitHash ? s.gitCommitHash.slice(0, 7) : "—") },
  { label: "Score changes detected", value: (s) => String(s.scoreChangesDetected) },
  { label: "Suggested moments generated", value: (s) => String(s.suggestedMomentsGenerated) },
  { label: "Localized successfully", value: (s) => String(s.localizedSuccessfully) },
  { label: "Localization fallback count", value: (s) => String(s.localizationFallbackCount) },
  { label: "Average localization confidence", value: (s) => formatConfidence(s.averageLocalizationConfidence) },
  { label: "Total processing time", value: (s) => formatSeconds(s.totalProcessingSeconds) },
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
                <td className="px-4 py-2 font-medium text-navy">{row.label}</td>
                <td className="px-4 py-2 text-black/70">{row.value(a)}</td>
                <td className="px-4 py-2 text-black/70">{row.value(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
