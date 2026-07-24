"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled app error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/5 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-bold text-navy">Something went wrong</h1>
        <p className="mt-2 text-sm text-black/60">
          That&apos;s an unexpected error, not something you did. Try again — if it keeps
          happening, it&apos;s worth checking the server logs.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-black/30">Error ID: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
          <Link
            href="/login"
            className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-navy"
          >
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
