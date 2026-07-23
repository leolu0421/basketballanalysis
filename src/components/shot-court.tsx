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
    <div
      ref={ref}
      onClick={handleClick}
      className={`relative w-full overflow-hidden rounded-lg bg-[#f4f5f2] ${
        onPick ? "cursor-crosshair" : ""
      } ${className}`}
      style={{ aspectRatio: "1 / 0.94" }}
    >
      <svg viewBox="0 0 100 94" className="absolute inset-0 h-full w-full">
        <rect x="1" y="1" width="98" height="92" fill="none" stroke="#cfd3cf" strokeWidth="0.6" />
        <rect x="33" y="1" width="34" height="19" fill="none" stroke="#cfd3cf" strokeWidth="0.6" />
        <circle cx="50" cy="20" r="6" fill="none" stroke="#cfd3cf" strokeWidth="0.6" />
        <rect x="46" y="1" width="8" height="5" fill="none" stroke="#cfd3cf" strokeWidth="0.5" />
        <circle cx="50" cy="6.5" r="0.9" fill="none" stroke="#cfd3cf" strokeWidth="0.5" />
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
  );
}
