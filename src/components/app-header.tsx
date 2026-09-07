"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Signals" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/sources", label: "Sources" },
  { href: "/stats", label: "Stats" },
] as const;

function isActive(pathname: string, href: string) {
  // "/" must match only itself, or every route lights up.
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      {/* min-w-0 + shrink-0 on the brand keeps the nav from pushing the row
          wider than the viewport at 320px, where it would otherwise clip. */}
      <div className="mx-auto flex h-11 w-full max-w-[1280px] items-center gap-3 px-4 sm:gap-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-[13px] font-semibold tracking-tight"
        >
          {/* Square mark. A pulse, not a logo. */}
          <span
            aria-hidden
            className="inline-block size-2 rounded-[1px] bg-bullish"
          />
          Signal Desk
        </Link>

        <nav
          aria-label="Primary"
          className="flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-sm px-2 py-1 text-[13px] transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          {/* Standing reminder of what this tool is. It is deliberately part of
              the chrome rather than a dismissible banner. */}
          <span className="hidden sm:inline">Research only — not advice</span>
        </div>
      </div>
    </header>
  );
}
