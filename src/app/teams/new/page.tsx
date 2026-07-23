"use client";

import { useActionState } from "react";
import { createTeamAction } from "@/lib/actions/team-actions";

export default function NewTeamPage() {
  const [state, formAction, pending] = useActionState(createTeamAction, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/5 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold">Set up your team</h1>
        <p className="mt-1 text-sm text-black/60">
          You&apos;ll be able to add players and games next.
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-black/70">Team name</label>
            <input
              name="name"
              type="text"
              required
              placeholder="Knox Raiders"
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black/70">
              Division <span className="text-black/40">(optional)</span>
            </label>
            <input
              name="division"
              type="text"
              placeholder="U16 Boys 3"
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 outline-none focus:border-brand"
            />
          </div>

          {state?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-navy px-4 py-2.5 font-semibold text-white transition hover:bg-navy-light disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create team"}
          </button>
        </form>
      </div>
    </div>
  );
}
