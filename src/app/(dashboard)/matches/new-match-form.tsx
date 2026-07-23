"use client";

import { useActionState } from "react";
import { createMatchAction } from "@/lib/actions/match-actions";

export function NewMatchForm() {
  const [state, formAction, pending] = useActionState(createMatchAction, undefined);

  return (
    <form action={formAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
      <input
        name="opponentName"
        placeholder="Opponent name"
        required
        className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <input
        name="date"
        type="date"
        required
        className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <input
        name="youtubeUrl"
        placeholder="YouTube link (optional)"
        className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-1"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add match"}
      </button>
      {state?.error && (
        <p className="col-span-full text-sm text-red-600">{state.error}</p>
      )}
    </form>
  );
}
