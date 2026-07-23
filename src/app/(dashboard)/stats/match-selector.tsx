"use client";

import { useRouter } from "next/navigation";

export function MatchSelector({
  matches,
  activeMatchId,
  tab,
  basePath,
}: {
  matches: { id: string; date: Date; opponentName: string }[];
  activeMatchId: string;
  tab: string;
  basePath: string;
}) {
  const router = useRouter();

  return (
    <select
      defaultValue={activeMatchId}
      onChange={(e) => router.push(`${basePath}?matchId=${e.target.value}&tab=${tab}`)}
      className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
    >
      {matches.map((m) => (
        <option key={m.id} value={m.id}>
          {m.date.toLocaleDateString()} vs {m.opponentName}
        </option>
      ))}
    </select>
  );
}
