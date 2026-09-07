import { PageTitle, StatePanel } from "@/components/page-shell";

export default function StatsPage() {
  return (
    <>
      <PageTitle
        title="Stats"
        subtitle="Hit rate and average return by event type, source and confidence."
      />
      <StatePanel
        title="No outcomes recorded yet"
        body={
          <>
            This page is the scorecard on the tool itself. Once signals exist,
            it reports hit rate and average return by event type, source,
            confidence bucket and prompt version — plus signals per day and
            LLM cost per day. A signal needs five trading days before it can be
            judged, so expect this to stay empty for about a week after the
            first real scan.
          </>
        }
      />
    </>
  );
}
