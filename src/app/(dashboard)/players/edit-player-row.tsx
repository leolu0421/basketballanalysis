"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updatePlayerAction, deletePlayerAction } from "@/lib/actions/team-actions";

type Player = {
  id: string;
  jerseyNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  _count: { statEvents: number };
};

export function EditPlayerRow({ player }: { player: Player }) {
  const [editing, setEditing] = useState(false);
  const updateWithId = updatePlayerAction.bind(null, player.id);
  const [state, formAction, pending] = useActionState(updateWithId, undefined);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setEditing(false);
    }
    wasPending.current = pending;
  }, [pending, state]);

  if (!editing) {
    return (
      <tr className="border-b border-black/5 last:border-0">
        <td className="px-4 py-3 font-semibold">#{player.jerseyNumber}</td>
        <td className="px-4 py-3">{player.firstName}</td>
        <td className="px-4 py-3">{player.lastName}</td>
        <td className="px-4 py-3 text-black/60">{player.email ?? "—"}</td>
        <td className="px-4 py-3 text-black/60">{player._count.statEvents}</td>
        <td className="px-4 py-3 text-right">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-brand hover:underline"
            >
              Edit
            </button>
            <form action={deletePlayerAction.bind(null, player.id)}>
              <button
                type="submit"
                className="text-xs font-medium text-red-500 hover:underline"
              >
                Remove
              </button>
            </form>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-black/5 last:border-0 bg-black/[0.02]">
      <td colSpan={6} className="px-4 py-3">
        <form
          action={formAction}
          className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-center"
        >
          <input
            name="jerseyNumber"
            defaultValue={player.jerseyNumber}
            required
            className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            name="firstName"
            defaultValue={player.firstName}
            required
            className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            name="lastName"
            defaultValue={player.lastName}
            required
            className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            name="email"
            type="email"
            defaultValue={player.email ?? ""}
            placeholder="Email (optional)"
            className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold text-black/60"
            >
              Cancel
            </button>
          </div>
          {state?.error && (
            <p className="col-span-full text-sm text-red-600">{state.error}</p>
          )}
        </form>
      </td>
    </tr>
  );
}
