import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeam } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { TaggingWorkspace } from "./tagging-workspace";
import { ScoreForm } from "./score-form";
import { deleteMatchAction } from "@/lib/actions/match-actions";
import { getVideoAnalysisStatus } from "@/lib/actions/video-analysis-actions";

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const { team } = await requireTeam();

  const match = await prisma.match.findFirst({
    where: { id: matchId, teamId: team.id },
  });
  if (!match) notFound();

  const [players, events, videoJob] = await Promise.all([
    prisma.player.findMany({
      where: { teamId: team.id },
      orderBy: { jerseyNumber: "asc" },
    }),
    prisma.statEvent.findMany({
      where: { matchId },
      orderBy: { createdAt: "asc" },
    }),
    getVideoAnalysisStatus(matchId),
  ]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/matches" className="text-sm text-black/50 hover:underline">
            ← Matches
          </Link>
          <h1 className="text-2xl font-bold text-navy">vs {match.opponentName}</h1>
          <p className="text-sm text-black/50">
            {match.date.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ScoreForm
            matchId={match.id}
            teamScore={match.teamScore}
            opponentScore={match.opponentScore}
            opponentName={match.opponentName}
          />
          <form action={deleteMatchAction.bind(null, match.id)}>
            <button type="submit" className="text-xs text-red-500 hover:underline">
              Delete match
            </button>
          </form>
        </div>
      </div>

      <div className="mt-6">
        <TaggingWorkspace
          matchId={match.id}
          youtubeVideoId={match.youtubeVideoId}
          players={players}
          events={events}
          initialVideoJob={videoJob}
        />
      </div>
    </div>
  );
}
