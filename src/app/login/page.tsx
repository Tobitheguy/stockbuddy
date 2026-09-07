import { LoginForm } from "@/components/login-form";

export const metadata = {
  title: "Sign in — Signal Desk",
  robots: { index: false, follow: false },
};

export default async function LoginPage(props: {
  // Written out rather than using the generated PageProps<"/login">: the route
  // types are emitted by `next build`, so a plain `tsc --noEmit` on a clean
  // checkout would not know this route exists yet.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.searchParams;
  const raw = params.next;
  const next = typeof raw === "string" ? raw : "";

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-sm flex-col justify-center">
      <h1 className="text-[20px] font-semibold tracking-tight">Signal Desk</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Private research feed. Sign in to continue.
      </p>
      <LoginForm next={next} />
    </div>
  );
}
