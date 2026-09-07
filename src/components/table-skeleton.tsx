import { cn } from "@/lib/utils";

/**
 * Loading placeholder shaped like the dense table, so the page does not jump
 * when real rows arrive. Widths vary per column to read as text rather than
 * as a progress bar.
 */
export function TableSkeleton({
  rows = 8,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const widths = ["w-12", "w-[420px]", "w-20", "w-16", "w-14", "w-8", "w-24"];

  return (
    <div
      className={cn("w-full", className)}
      role="status"
      aria-label="Loading signals"
    >
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 py-1">
            {widths.map((w, c) => (
              <div
                key={c}
                className={cn(
                  "h-3 max-w-full animate-pulse rounded-[2px] bg-surface-raised",
                  w,
                )}
                // Stagger so the row does not pulse as one solid block.
                style={{ animationDelay: `${(r * 7 + c * 3) % 11 * 60}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
