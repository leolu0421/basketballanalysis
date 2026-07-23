"use client";

import { useActionState } from "react";
import { updateMatchScoreAction } from "@/lib/actions/match-actions";

export function ScoreForm({
  matchId,
  teamScore,
  opponentScore,
  opponentName,
}: {
  matchId: string;
  teamScore: number | null;
  opponentScore: number | null;
  opponentName: string;
}) {
  const action = updateMatchScoreAction.bind(null, matchId);
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase text-black/40">Us</span>
      <input
        name="teamScore"
        type="number"
        min={0}
        defaultValue={teamScore ?? ""}
        className="w-16 rounded-lg border border-black/10 px-2 py-1.5 text-sm"
      />
      <span className="text-black/30">–</span>
      <input
        name="opponentScore"
        type="number"
        min={0}
        defaultValue={opponentScore ?? ""}
        className="w-16 rounded-lg border border-black/10 px-2 py-1.5 text-sm"
      />
      <span className="text-xs font-semibold uppercase text-black/40">
        {opponentName}
      </span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        Save
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
