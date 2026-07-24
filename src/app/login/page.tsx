"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginAction } from "@/lib/actions/auth-actions";
import { Logo } from "@/components/logo";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);
  const searchParams = useSearchParams();
  const justReset = searchParams.get("reset") === "success";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/5 bg-white p-8 shadow-sm">
        <Logo markClassName="h-9 w-9 text-navy" size="text-2xl" />
        <p className="mt-1 text-sm text-black/60">Log in to your coach account</p>

        {justReset && (
          <p className="mt-4 rounded-lg bg-brand/15 px-3 py-2 text-sm text-brand-dark">
            Password updated — log in with your new password.
          </p>
        )}

        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-black/70">Email</label>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 outline-none focus:border-brand"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-black/70">Password</label>
              <Link href="/forgot-password" className="text-xs text-brand-dark">
                Forgot password?
              </Link>
            </div>
            <input
              name="password"
              type="password"
              required
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
            {pending ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-black/60">
          No account yet?{" "}
          <Link href="/signup" className="font-medium text-brand-dark">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
