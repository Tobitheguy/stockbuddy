import { PageTitle, StatePanel } from "@/components/page-shell";

export default async function TickerPage({
  params,
}: PageProps<"/t/[symbol]">) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  return (
    <>
      <PageTitle
        title={upper}
        subtitle="All signals for this symbol, with a 90-day price sparkline and outcomes."
      />
      <StatePanel
        title={`No signals stored for ${upper}`}
        body={
          <>
            The ticker page lands in Step 5: every signal for the symbol, the
            90-day close sparkline, the next earnings date, and the recorded
            +1/+5/+20 day outcomes.
          </>
        }
      />
    </>
  );
}
