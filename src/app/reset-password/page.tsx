"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPasswordAction } from "@/lib/actions/password-reset-actions";
import { Logo } from "@/components/logo";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, formAction, pending] = useActionState(resetPasswordAction, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/5 bg-white p-8 shadow-sm">
        <Logo markClassName="h-9 w-9 text-navy" size="text-2xl" />
        <p className="mt-1 text-sm text-black/60">Set a new password</p>

        {!token ? (
          <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            This link is missing its reset token. Request a new one from the{" "}
            <Link href="/forgot-password" className="underline">
              forgot password
            </Link>{" "}
            page.
          </p>
        ) : (
          <form action={formAction} className="mt-6 space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <label className="block text-sm font-medium text-black/70">New password</label>
              <input
                name="password"
                type="password"
                required
                minLength={8}
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black/70">Confirm password</label>
              <input
                name="confirmPassword"
                type="password"
                required
                minLength={8}
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
              {pending ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
