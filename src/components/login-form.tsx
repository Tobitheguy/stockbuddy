"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "@/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function SubmitButton() {
  // useFormStatus only reports the pending state of the form it is rendered
  // inside, which is why this is a child component rather than a hook call in
  // LoginForm — there it would always read false.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {
    error: null,
  });

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted-foreground">
          Email
        </span>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted-foreground">
          Password
        </span>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-bearish/30 bg-bearish/5 px-3 py-2 text-[12px] text-bearish"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
