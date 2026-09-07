import Link from "next/link";
import { PageTitle, StatePanel } from "@/components/page-shell";

export default function NotFound() {
  return (
    <>
      <PageTitle title="Not found" />
      <StatePanel
        title="No such page"
        body={
          <Link href="/" className="underline hover:text-foreground">
            Back to the signal feed
          </Link>
        }
      />
    </>
  );
}
