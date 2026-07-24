"use client";

import { useState, useTransition } from "react";
import { saveReferenceStatsAction } from "@/lib/actions/reference-stats-actions";

type Player = { id: string; firstName: string; lastName: string; jerseyNumber: string };

type Logged = { fg2m: number; fg3m: number; ftm: number; pf: number };

type ReferenceRow = {
  playerId: string;
  fg2Made: number;
  fg3Made: number;
  ftMade: number;
  fouls: number;
};

const FIELDS: { key: keyof Omit<ReferenceRow, "playerId">; label: string; loggedKey: keyof Logged }[] = [
  { key: "fg2Made", label: "2PT Made", loggedKey: "fg2m" },
  { key: "fg3Made", label: "3PT Made", loggedKey: "fg3m" },
  { key: "ftMade", label: "FT Made", loggedKey: "ftm" },
  { key: "fouls", label: "Fouls", loggedKey: "pf" },
];

export function ReferenceCheck({
  matchId,
  players,
  loggedByPlayer,
  initialReference,
}: {
  matchId: string;
  players: Player[];
  loggedByPlayer: Record<string, Logged>;
  initialReference: ReferenceRow[];
}) {
  const initial = Object.fromEntries(
    players.map((p) => {
      const existing = initialReference.find((r) => r.playerId === p.id);
      return [
        p.id,
        {
          fg2Made: existing?.fg2Made ?? 0,
          fg3Made: existing?.fg3Made ?? 0,
          ftMade: existing?.ftMade ?? 0,
          fouls: existing?.fouls ?? 0,
        },
      ];
    })
  ) as Record<string, Omit<ReferenceRow, "playerId">>;

  const [values, setValues] = useState(initial);
  const [hasSaved, setHasSaved] = useState(initialReference.length > 0);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);

  function setValue(playerId: string, key: keyof Omit<ReferenceRow, "playerId">, raw: string) {
    const num = Math.max(0, Math.floor(Number(raw) || 0));
    setValues((prev) => ({ ...prev, [playerId]: { ...prev[playerId], [key]: num } }));
    setSavedMessage(false);
  }

  function handleSave() {
    setError(null);
    const lines: ReferenceRow[] = players.map((p) => ({ playerId: p.id, ...values[p.id] }));
    startTransition(async () => {
      const result = await saveReferenceStatsAction(matchId, lines);
      if (result?.error) {
        setError(result.error);
      } else {
        setHasSaved(true);
        setSavedMessage(true);
      }
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-black/5 bg-white p-4">
      <h3 className="text-sm font-semibold text-navy">Reference stats check</h3>
      <p className="mt-1 text-xs text-black/50">
        Type in the final made-shot and foul counts from an outside source (e.g. MyHoops) for
        this game — logged stats below are flagged if they don&apos;t match.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-black/40">
              <th className="px-2 py-2">Player</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="px-2 py-2" colSpan={2}>
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const logged = loggedByPlayer[p.id] ?? { fg2m: 0, fg3m: 0, ftm: 0, pf: 0 };
              return (
                <tr key={p.id} className="border-b border-black/5 last:border-0">
                  <td className="px-2 py-2 font-medium text-navy">
                    #{p.jerseyNumber} {p.firstName}
                  </td>
                  {FIELDS.map((f) => {
                    const loggedValue = logged[f.loggedKey];
                    const refValue = values[p.id][f.key];
                    const mismatch = hasSaved && loggedValue !== refValue;
                    return (
                      <td key={f.key} className="px-2 py-2" colSpan={2}>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            value={refValue}
                            onChange={(e) => setValue(p.id, f.key, e.target.value)}
                            className={`w-14 rounded-md border px-1.5 py-1 text-xs outline-none focus:border-brand ${
                              mismatch ? "border-red-300 bg-red-50" : "border-black/10"
                            }`}
                          />
                          <span
                            className={`text-xs ${mismatch ? "text-red-600" : "text-black/40"}`}
                            title="Logged in this app"
                          >
                            logged {loggedValue}
                            {mismatch ? " ⚠️" : hasSaved ? " ✓" : ""}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save reference stats"}
        </button>
        {savedMessage && <span className="text-xs text-green-600">Saved.</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
