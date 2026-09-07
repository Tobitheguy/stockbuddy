"use client";

import { useState, useTransition } from "react";
import { addToWatchlist, removeFromWatchlist } from "@/app/actions";
import { cn } from "@/lib/utils";

/**
 * The + button.
 *
 * Adding captures the price at that instant, so the button is doing more than
 * bookmarking — it is starting a measurement. If the price capture fails the
 * add still succeeds and the message says what happened, rather than the
 * symbol silently arriving with no entry price.
 */
export function WatchlistButton({
  symbol,
  initiallyWatched,
  size = "sm",
}: {
  symbol: string;
  initiallyWatched: boolean;
  size?: "sm" | "lg";
}) {
  const [watched, setWatched] = useState(initiallyWatched);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    setMessage(null);
    startTransition(async () => {
      const result = watched
        ? await removeFromWatchlist(symbol)
        : await addToWatchlist(symbol);

      if (result.ok) {
        setWatched(!watched);
        if (result.note) setMessage(result.note);
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={watched}
        aria-label={
          watched
            ? `Remove ${symbol} from watchlist`
            : `Add ${symbol} to watchlist and record today's price`
        }
        title={
          watched
            ? `Remove ${symbol} from your watchlist`
            : `Track ${symbol} and record today's price as your entry point`
        }
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md border transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          size === "lg" ? "h-8 gap-1.5 px-3 text-[13px]" : "size-6 text-[14px]",
          pending && "opacity-50",
          watched
            ? "border-bullish/40 bg-bullish-dim text-bullish"
            : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        )}
      >
        <span aria-hidden className="leading-none">
          {watched ? "★" : "+"}
        </span>
        {size === "lg" ? (
          <span>{watched ? "On watchlist" : "Add to watchlist"}</span>
        ) : null}
      </button>

      {message ? (
        <span className="max-w-[280px] text-[11px] text-muted-foreground">
          {message}
        </span>
      ) : null}
    </span>
  );
}
