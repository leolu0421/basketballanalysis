"use client";

import { useActionState, useRef, useEffect } from "react";
import { addPlayerAction } from "@/lib/actions/team-actions";

export function AddPlayerForm() {
  const [state, formAction, pending] = useActionState(addPlayerAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && !state?.error) {
      formRef.current?.reset();
    }
  }, [pending, state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5"
    >
      <input
        name="jerseyNumber"
        placeholder="#"
        required
        className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <input
        name="firstName"
        placeholder="First name"
        required
        className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <input
        name="lastName"
        placeholder="Last name"
        required
        className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <input
        name="email"
        type="email"
        placeholder="Email (optional)"
        className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add player"}
      </button>
      {state?.error && (
        <p className="col-span-full text-sm text-red-600">{state.error}</p>
      )}
    </form>
  );
}
