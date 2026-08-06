"use client";

import { useRef } from "react";

export type Shot = { x: number; y: number; made: boolean };

/**
 * Simplified half-court diagram. Coordinates are normalized 0-1
 * (x: baseline-to-baseline width, y: sideline-to-sideline, basket near y=1).
 */
export function ShotCourt({
  shots = [],
  onPick,
  className = "",
}: {
  shots?: Shot[];
  onPick?: (x: number, y: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onPick || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onPick(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  }

  return (
    // Outer panel: just the background + a real CSS gap around the court,
    // so the drawn boundary doesn't sit flush against this panel's own
    // edge. The inner div below (not this one) is what handleClick measures
    // and what shot markers position against — kept as an unpadded 0-1
    // normalized box so click-to-coordinate mapping and existing stored
    // shot x/y values are completely unaffected by this visual margin.
    <div className={`overflow-hidden rounded-lg bg-[#f4f5f2] p-3 ${className}`}>
      <div
        ref={ref}
        onClick={handleClick}
        className={`relative w-full ${onPick ? "cursor-crosshair" : ""}`}
        style={{ aspectRatio: "1 / 0.94" }}
      >
        <svg viewBox="0 0 100 94" className="absolute inset-0 h-full w-full overflow-visible">
          {/* half-court boundary */}
          <rect x="1" y="1" width="98" height="92" fill="none" stroke="#cfd3cf" strokeWidth="0.6" />
          {/* free-throw lane ("the key") */}
          <rect x="33" y="1" width="34" height="19" fill="none" stroke="#cfd3cf" strokeWidth="0.6" />
          {/* free-throw circle */}
          <circle cx="50" cy="20" r="6" fill="none" stroke="#cfd3cf" strokeWidth="0.6" />
          {/* backboard — a flat line near the baseline, not a filled box */}
          <line x1="44" y1="4" x2="56" y2="4" stroke="#cfd3cf" strokeWidth="0.8" />
          {/* restricted-area arc under the basket */}
          <path d="M 42 5.5 A 8 8 0 0 0 58 5.5" fill="none" stroke="#cfd3cf" strokeWidth="0.5" />
          {/* rim, out in front of the backboard */}
          <circle cx="50" cy="5.5" r="1" fill="none" stroke="#cfd3cf" strokeWidth="0.6" />
          {/* three-point arc */}
          <path
            d="M 4 30 A 46 46 0 0 0 96 30"
            fill="none"
            stroke="#cfd3cf"
            strokeWidth="0.6"
          />
        </svg>

        {shots.map((s, i) => (
          <div
            key={i}
            className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
              s.made ? "border-navy bg-navy" : "border-red-400 bg-white"
            }`}
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
