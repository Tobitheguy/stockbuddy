"use client";

import { useEffect } from "react";
import { PageTitle, StatePanel } from "@/components/page-shell";

/**
 * Route-level error boundary.
 *
 * Deliberately does NOT print `error.message` to the page. Once Step 3 lands,
 * a thrown error can carry a database URL or an upstream API response, and
 * this is a public HTTPS deployment. The digest is enough to correlate with
 * the server log.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server logs get the real error; the browser gets the digest only.
    console.error("Route error", error.digest ?? error);
  }, [error]);

  return (
    <>
      <PageTitle title="Something broke" />
      <StatePanel
        tone="error"
        title="This page failed to render"
        body={
          <div className="space-y-3">
            <p>
              The scanner and the dashboard are independent — a failure here
              does not stop signals being collected.
            </p>
            {error.digest ? (
              <p className="num text-[11px]">digest: {error.digest}</p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="rounded-sm border border-border bg-surface-raised px-2 py-1 text-[12px] text-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Try again
            </button>
          </div>
        }
      />
    </>
  );
}
