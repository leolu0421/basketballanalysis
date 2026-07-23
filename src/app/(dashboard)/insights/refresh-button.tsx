"use client";

import { useTransition, useState } from "react";
import { refreshTeamInsightsAction } from "@/lib/actions/insights-actions";

export function RefreshInsightsButton({
  matchId,
  aiConfigured,
}: {
  matchId: string;
  aiConfigured: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await refreshTeamInsightsAction(matchId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={isPending || !aiConfigured}
        title={aiConfigured ? undefined : "Set ANTHROPIC_API_KEY to enable AI insights"}
        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-navy disabled:opacity-40"
      >
        {isPending ? "Generating…" : "↻ Refresh"}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
