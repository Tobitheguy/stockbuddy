import { PageTitle, StatePanel } from "@/components/page-shell";

export default function WatchlistPage() {
  return (
    <>
      <PageTitle
        title="Watchlist"
        subtitle="Starred tickers, with next earnings dates inside 14 days."
      />
      <StatePanel
        title="Nothing on the watchlist yet"
        body={
          <>
            Star a ticker from the signal feed or a ticker page to track it
            here. Wired up in Step 5, once the database exists.
          </>
        }
      />
    </>
  );
}
