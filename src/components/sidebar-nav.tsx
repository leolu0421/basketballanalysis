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

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-3">
      {LIVE_LINKS.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-brand/15 text-navy"
                : "text-black/70 hover:bg-black/5"
            }`}
          >
            {link.label}
          </Link>
        );
      })}

      <div className="mt-2 border-t border-black/5 pt-2">
        {SOON_LINKS.map((label) => (
          <div
            key={label}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-black/30"
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
