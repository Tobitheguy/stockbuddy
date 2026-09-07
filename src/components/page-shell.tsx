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
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
      {subtitle ? (
        <p className="text-[13px] text-muted-foreground">{subtitle}</p>
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
        "rounded-lg border border-border bg-card px-5 py-7 text-center shadow-[0_1px_2px_rgb(16_24_40/0.04)]",
        tone === "error" && "border-bearish/35 bg-bearish-dim",
        className,
      )}
    >
      <p
        className={cn(
          "text-[14px] font-semibold",
          tone === "error" ? "text-bearish" : "text-foreground",
        )}
      >
        {title}
      </p>
      {body ? (
        <div className="mx-auto mt-1.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
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
