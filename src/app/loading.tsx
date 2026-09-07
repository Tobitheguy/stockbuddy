import { TableSkeleton } from "@/components/table-skeleton";

/**
 * Route-level loading fallback. Applies to every page under the app router
 * that does not define its own, so a slow database query in Step 5 shows the
 * table shape instead of a blank screen.
 */
export default function Loading() {
  return (
    <>
      <div className="mb-3 flex items-baseline gap-3">
        <div className="h-4 w-24 animate-pulse rounded-[2px] bg-surface-raised" />
        <div className="h-3 w-64 animate-pulse rounded-[2px] bg-surface" />
      </div>
      <TableSkeleton />
    </>
  );
}
