import { cn } from "@/lib/utils";

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
      {subtitle ? (
        <p className="text-[12px] text-muted-foreground">{subtitle}</p>
      ) : null}
      {actions ? <div className="ml-auto">{actions}</div> : null}
    </div>
  );
}

/**
 * Empty and error states share one shape. Both are common in this product:
 * before the first scan there are no signals, and a source can fail.
 */
export function StatePanel({
  title,
  body,
  tone = "muted",
  className,
}: {
  title: string;
  body?: React.ReactNode;
  tone?: "muted" | "error";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface px-4 py-6 text-center",
        tone === "error" && "border-bearish/40",
        className,
      )}
    >
      <p
        className={cn(
          "text-[13px] font-medium",
          tone === "error" ? "text-bearish" : "text-foreground",
        )}
      >
        {title}
      </p>
      {body ? (
        <div className="mx-auto mt-1 max-w-prose text-[12px] text-muted-foreground">
          {body}
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal scroll container so a wide table never scrolls the page body. */
export function TableScroller({ children }: { children: React.ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>;
}
