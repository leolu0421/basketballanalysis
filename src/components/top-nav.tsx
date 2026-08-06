"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LIVE_LINKS = [
  { href: "/matches", label: "Matches" },
  { href: "/players", label: "Players" },
  { href: "/stats", label: "Stats" },
  { href: "/insights", label: "Insights" },
  { href: "/performance", label: "Performance" },
];

const SOON_LINKS = ["Assistant Coach", "Resources", "Credits"];

/**
 * Horizontal nav row under the header (replaces the old left sidebar — see
 * DashboardLayout). Same links, same active-state logic, just laid out
 * left-to-right instead of top-to-bottom.
 */
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto px-6 pb-3">
      {LIVE_LINKS.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active ? "bg-brand/15 text-navy" : "text-black/70 hover:bg-black/5"
            }`}
          >
            {link.label}
          </Link>
        );
      })}

      <div className="ml-1 flex items-center gap-1 border-l border-black/5 pl-2">
        {SOON_LINKS.map((label) => (
          <div
            key={label}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-black/30"
            title="Coming soon"
          >
            {label}
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
              Soon
            </span>
          </div>
        ))}
      </div>
    </nav>
  );
}
