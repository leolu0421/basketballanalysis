import Link from "next/link";
import { requireTeam } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  computeBoxScoreByPlayer,
  sumBoxScoreLines,
  computeTeamInsightsMetrics,
} from "@/lib/stats";
import { isAiConfigured } from "@/lib/ai/insights";
import { getCachedTeamInsights } from "@/lib/actions/insights-actions";
import { MatchSelector } from "@/components/match-selector";
import { RefreshInsightsButton } from "./refresh-button";

const BADGE_STYLES: Record<string, string> = {
  NEEDS_FOCUS: "bg-red-100 text-red-600",
  AVERAGE: "bg-black/10 text-black/60",
  GOOD: "bg-brand/20 text-brand-dark",
  SUPER: "bg-navy text-white",
};

const BADGE_LABELS: Record<string, string> = {
  NEEDS_FOCUS: "Needs Focus",
  AVERAGE: "Average",
  GOOD: "Good",
  SUPER: "Super",
};

function Badge({ badge }: { badge: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
        BADGE_STYLES[badge] ?? BADGE_STYLES.AVERAGE
      }`}
    >
      {BADGE_LABELS[badge] ?? badge}
    </span>
  );
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ matchId?: string }>;
}) {
  const { team } = await requireTeam();
  const { matchId } = await searchParams;

  const matches = await prisma.match.findMany({
    where: { teamId: team.id },
    orderBy: { date: "desc" },
  });

  if (matches.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-navy">Insights</h1>
        <p className="mt-4 text-black/50">
          No matches yet.{" "}
          <Link href="/matches" className="text-brand-dark underline">
            Add a match
          </Link>{" "}
          and tag some stats to generate AI insights.
        </p>
      </div>
    );
  }

  const activeMatch = matches.find((m) => m.id === matchId) ?? matches[0];
  const events = await prisma.statEvent.findMany({ where: { matchId: activeMatch.id } });
  const teamLine = sumBoxScoreLines(Object.values(computeBoxScoreByPlayer(events)));
  const metrics = computeTeamInsightsMetrics(teamLine);
  const aiConfigured = isAiConfigured();
  const insights = await getCachedTeamInsights(activeMatch.id);

  const metricCards = [
    {
      key: "shotMix",
      label: "Shot Mix",
      value: `${metrics.shotMixPct.toFixed(1)}%`,
      sub: "2PT Field Goals",
    },
    {
      key: "pointsPerShot",
      label: "Points Per Shot",
      value: metrics.pointsPerShot.toFixed(2),
      sub: "Efficiency",
    },
    {
      key: "assistRate",
      label: "Assist Rate",
      value: `${metrics.assistRatePct.toFixed(0)}%`,
      sub: "Team Play",
    },
    {
      key: "turnovers",
      label: "Turnovers",
      value: String(metrics.turnovers),
      sub: "Needs Focus",
    },
    {
      key: "rebounds",
      label: "Rebounds",
      value: String(metrics.rebounds),
      sub: "Total",
    },
    {
      key: "defensiveImpact",
      label: "Defensive Impact",
      value: String(metrics.defensiveImpact),
      sub: "Steals + Blocks",
    },
  ] as const;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Insights</h1>
          <p className="text-sm text-black/50">AI-powered analysis of your team&apos;s performance.</p>
        </div>
        <div className="flex items-center gap-3">
          <MatchSelector matches={matches} activeMatchId={activeMatch.id} basePath="/insights" />
          <RefreshInsightsButton matchId={activeMatch.id} aiConfigured={aiConfigured} />
        </div>
      </div>

      {!aiConfigured && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          AI insights aren&apos;t configured yet. Set an <code>ANTHROPIC_API_KEY</code> environment
          variable to enable AI-generated analysis.
        </div>
      )}

      {!insights && aiConfigured && (
        <div className="mt-6 rounded-xl border border-dashed border-black/10 bg-white px-5 py-10 text-center text-black/40">
          No insights generated for this game yet — click Refresh above.
        </div>
      )}

      {insights && (
        <>
          <div className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-black/40">
              Overview
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-black/5 bg-white p-4">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-navy">
                  ✓ What&apos;s Working
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-black/70">
                  {insights.whatsWorking.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-black/5 bg-white p-4">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-navy">
                  ◎ Focus Areas
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-black/70">
                  {insights.focusAreas.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-black/5 bg-white p-4 md:col-span-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-navy">
                  ✎ Suggestions
                </h3>
                <p className="mt-2 text-sm text-black/70">{insights.suggestions}</p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-black/40">
              A Closer Look
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {metricCards.map((card) => {
                const metric = insights.metrics[card.key];
                return (
                  <div key={card.key} className="rounded-xl border border-black/5 bg-white p-4">
                    <p className="text-xs font-semibold uppercase text-black/40">{card.label}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-2xl font-bold text-navy">{card.value}</span>
                      <Badge badge={metric.badge} />
                    </div>
                    <p className="text-xs text-black/40">{card.sub}</p>
                    <p className="mt-2 text-sm text-black/60">{metric.narrative}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
