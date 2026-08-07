import Link from "next/link";
import { getAnalysisSummaryById } from "@/lib/actions/eval-actions";
import { getBenchmarkEvaluationByJobId, getPlayerLabels } from "@/lib/actions/benchmark-eval-actions";
import type { PrecisionRecallF1, QuarterRecall, FalseNegativeStage } from "@/lib/benchmark-eval";
import { FALSE_NEGATIVE_STAGES } from "@/lib/benchmark-eval";

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

type Evaluation = NonNullable<Awaited<ReturnType<typeof getBenchmarkEvaluationByJobId>>>;

const ACCURACY_ROWS: Array<{ label: string; help: string; isPercent: boolean; value: (e: Evaluation) => number }> = [
  {
    label: "Ground truth events",
    help: "MANUAL-source StatEvent rows this run was scored against — the fixed answer key.",
    isPercent: false,
    value: (e) => e.groundTruthEventCount,
  },
  { label: "AI events", help: "VideoAnalysisCandidate rows produced by this run.", isPercent: false, value: (e) => e.aiEventCount },
  {
    label: "True positives",
    help: "Same player, same stat type, timestamp within tolerance.",
    isPercent: false,
    value: (e) => e.truePositives,
  },
  { label: "False positives", help: "AI event with no matching ground-truth event.", isPercent: false, value: (e) => e.falsePositives },
  { label: "False negatives", help: "Ground-truth event with no matching AI event.", isPercent: false, value: (e) => e.falseNegatives },
  { label: "Precision", help: "TP / (TP + FP) — of what the AI reported, how much was right.", isPercent: true, value: (e) => e.precision },
  { label: "Recall", help: "TP / (TP + FN) — of what really happened, how much the AI caught.", isPercent: true, value: (e) => e.recall },
  { label: "F1", help: "Harmonic mean of precision and recall.", isPercent: true, value: (e) => e.f1 },
];

function formatMetric(value: number, isPercent: boolean) {
  return isPercent ? `${Math.round(value * 100)}%` : String(value);
}

function DeltaLabel({ from, to, isPercent }: { from: number; to: number; isPercent: boolean }) {
  const diff = to - from;
  if (diff === 0) return null;
  const sign = diff > 0 ? "+" : "";
  const text = isPercent ? `${sign}${Math.round(diff * 100)}%` : `${sign}${diff}`;
  return <span className={`ml-1.5 text-xs ${diff > 0 ? "text-green-600" : "text-red-600"}`}>({text})</span>;
}

type PRF1Map = Record<string, PrecisionRecallF1>;
type QuarterMap = Record<string, QuarterRecall>;
type StageMap = Record<FalseNegativeStage, number>;

/** Compact side-by-side A/B table for a {key: PrecisionRecallF1} breakdown (per stat type, per player). */
function BreakdownTable({
  title,
  firstColumnLabel,
  keys,
  labelFor,
  a,
  b,
}: {
  title: string;
  firstColumnLabel: string;
  keys: string[];
  labelFor: (key: string) => string;
  a: PRF1Map | null;
  b: PRF1Map | null;
}) {
  if (keys.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-black/5 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-navy">{title}</summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead>
            <tr className="text-black/40">
              <th className="py-1 pr-2">{firstColumnLabel}</th>
              <th className="py-1 pr-2 text-right">A: P / R / F1</th>
              <th className="py-1 pr-2 text-right">B: P / R / F1</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const rowA = a?.[key];
              const rowB = b?.[key];
              const fmt = (row: PrecisionRecallF1 | undefined) =>
                row ? `${formatMetric(row.precision, true)} / ${formatMetric(row.recall, true)} / ${formatMetric(row.f1, true)}` : "—";
              return (
                <tr key={key} className="border-t border-black/5">
                  <td className="py-1 pr-2 font-medium text-navy">{labelFor(key)}</td>
                  <td className="py-1 pr-2 text-right text-black/70">{fmt(rowA)}</td>
                  <td className="py-1 pr-2 text-right text-black/70">{fmt(rowB)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function QuarterBreakdownTable({ a, b }: { a: QuarterMap | null; b: QuarterMap | null }) {
  const quarters = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort((x, y) => Number(x) - Number(y));
  if (quarters.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-black/5 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-navy">
        Per quarter (recall only — see note below)
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full min-w-[320px] text-left text-xs">
          <thead>
            <tr className="text-black/40">
              <th className="py-1 pr-2">Quarter</th>
              <th className="py-1 pr-2 text-right">A: Recall</th>
              <th className="py-1 pr-2 text-right">B: Recall</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q) => (
              <tr key={q} className="border-t border-black/5">
                <td className="py-1 pr-2 font-medium text-navy">Q{q}</td>
                <td className="py-1 pr-2 text-right text-black/70">{a?.[q] ? formatMetric(a[q].recall, true) : "—"}</td>
                <td className="py-1 pr-2 text-right text-black/70">{b?.[q] ? formatMetric(b[q].recall, true) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-black/40">
          Precision isn&apos;t shown per quarter — an AI event carries no quarter of its own, so a false positive
          can&apos;t be reliably attributed to one.
        </p>
      </div>
    </details>
  );
}

function StageBreakdownTable({ a, b }: { a: StageMap | null; b: StageMap | null }) {
  if (!a && !b) return null;
  return (
    <details className="mt-3 rounded-lg border border-black/5 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-navy">
        Where missed events failed (pipeline stage)
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead>
            <tr className="text-black/40">
              <th className="py-1 pr-2">Stage</th>
              <th className="py-1 pr-2 text-right">A</th>
              <th className="py-1 pr-2 text-right">B</th>
            </tr>
          </thead>
          <tbody>
            {FALSE_NEGATIVE_STAGES.map((stage) => (
              <tr key={stage} className="border-t border-black/5">
                <td className="py-1 pr-2 font-medium text-navy">{stage.replace(/_/g, " ")}</td>
                <td className="py-1 pr-2 text-right text-black/70">{a?.[stage] ?? "—"}</td>
                <td className="py-1 pr-2 text-right text-black/70">{b?.[stage] ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

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

  const [evalA, evalB] = await Promise.all([
    getBenchmarkEvaluationByJobId(a.jobId),
    getBenchmarkEvaluationByJobId(b.jobId),
  ]);

  const perStatTypeA = (evalA?.perStatTypeBreakdown ?? null) as PRF1Map | null;
  const perStatTypeB = (evalB?.perStatTypeBreakdown ?? null) as PRF1Map | null;
  const statTypes = [...new Set([...Object.keys(perStatTypeA ?? {}), ...Object.keys(perStatTypeB ?? {})])].sort();

  const perPlayerA = (evalA?.perPlayerBreakdown ?? null) as PRF1Map | null;
  const perPlayerB = (evalB?.perPlayerBreakdown ?? null) as PRF1Map | null;
  const playerIds = [...new Set([...Object.keys(perPlayerA ?? {}), ...Object.keys(perPlayerB ?? {})])];
  const playerLabels = await getPlayerLabels(playerIds);

  const perQuarterA = (evalA?.perQuarterBreakdown ?? null) as QuarterMap | null;
  const perQuarterB = (evalB?.perQuarterBreakdown ?? null) as QuarterMap | null;
  const stagesA = (evalA?.falseNegativeStageBreakdown ?? null) as StageMap | null;
  const stagesB = (evalB?.falseNegativeStageBreakdown ?? null) as StageMap | null;

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

      <h2 className="mt-6 text-lg font-semibold text-navy">Accuracy against ground truth</h2>
      {!evalA && !evalB ? (
        <p className="mt-2 text-sm text-black/50">
          Neither run has been evaluated against ground truth yet — go to{" "}
          <Link href="/eval" className="text-navy hover:underline">
            /eval
          </Link>{" "}
          and click Evaluate on a benchmark run.
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto rounded-xl border border-black/5 bg-white">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-black/40">
                  <th className="px-4 py-2">Metric</th>
                  <th className="px-4 py-2">Run A</th>
                  <th className="px-4 py-2">Run B</th>
                </tr>
              </thead>
              <tbody>
                {ACCURACY_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2 font-medium text-navy" title={row.help}>
                      <span className="cursor-help underline decoration-dotted">{row.label}</span>
                    </td>
                    <td className="px-4 py-2 text-black/70">{evalA ? formatMetric(row.value(evalA), row.isPercent) : "—"}</td>
                    <td className="px-4 py-2 text-black/70">
                      {evalB ? formatMetric(row.value(evalB), row.isPercent) : "—"}
                      {evalA && evalB && <DeltaLabel from={row.value(evalA)} to={row.value(evalB)} isPercent={row.isPercent} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(evalA?.toleranceSeconds ?? evalB?.toleranceSeconds) != null && (
            <p className="mt-2 text-xs text-black/40">
              Matching tolerance: ±{evalA?.toleranceSeconds ?? evalB?.toleranceSeconds}s. A match requires the same
              player, the same stat type, and a timestamp within tolerance — quarter isn&apos;t a matching
              precondition (candidates don&apos;t carry one), only a per-quarter reporting dimension below.
            </p>
          )}

          <BreakdownTable
            title="Per stat type"
            firstColumnLabel="Stat type"
            keys={statTypes}
            labelFor={(k) => k}
            a={perStatTypeA}
            b={perStatTypeB}
          />
          <BreakdownTable
            title="Per player"
            firstColumnLabel="Player"
            keys={playerIds}
            labelFor={(k) => playerLabels[k] ?? k}
            a={perPlayerA}
            b={perPlayerB}
          />
          <QuarterBreakdownTable a={perQuarterA} b={perQuarterB} />
          <StageBreakdownTable a={stagesA} b={stagesB} />
        </>
      )}
    </div>
  );
}
