"use client";

import { useState, useTransition } from "react";
import { setOwned } from "@/app/actions";
import { cn } from "@/lib/utils";

/**
 * "I own this" toggle for a watchlist row.
 *
 * Optimistic: flips immediately and reverts on failure. The distinction it
 * records — holding versus just watching — changes how a row should be read:
 * bearish news on a watched stock is information, bearish news on a held one
 * is exposure.
 */
export function OwnedToggle({
  symbol,
  initiallyOwned,
}: {
  symbol: string;
  initiallyOwned: boolean;
}) {
  const [owned, setOwnedState] = useState(initiallyOwned);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={owned}
      title={
        owned
          ? `You hold ${symbol}. Click to mark as watching only.`
          : `Mark ${symbol} as a position you actually hold.`
      }
      onClick={() => {
        const next = !owned;
        setOwnedState(next);
        startTransition(async () => {
          const result = await setOwned(symbol, next);
          if (!result.ok) setOwnedState(!next); // revert, keep the truth
        });
      }}
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        owned
          ? "bg-bullish/10 text-bullish"
          : "bg-surface text-muted-foreground hover:bg-surface-raised hover:text-foreground",
      )}
    >
      {owned ? "Owned" : "Watching"}
    </button>
  );
}
