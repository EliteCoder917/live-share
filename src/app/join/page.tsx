"use client";

import Link from "next/link";
import { useActionState } from "react";
import { joinSessionAction, type JoinState } from "@/app/actions/sessions";
import { SubmitButton } from "@/components/SubmitButton";

const initial: JoinState = {};

export default function JoinPage() {
  const [state, formAction] = useActionState(joinSessionAction, initial);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="text-sm text-neutral-400 hover:underline">
        ← Home
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Join a session</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Enter the code the host shared with you.
      </p>

      <form action={formAction} className="mt-8 space-y-4">
        <div>
          <label className="label" htmlFor="code">
            Join code
          </label>
          <input
            id="code"
            name="code"
            required
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="K7P3Q2"
            className="input text-center font-mono text-2xl uppercase tracking-[0.4em]"
          />
        </div>
        <div>
          <label className="label" htmlFor="guestLabel">
            Your name <span className="text-neutral-500">(optional)</span>
          </label>
          <input id="guestLabel" name="guestLabel" className="input" />
        </div>

        {state.error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {state.error}
          </p>
        )}

        <SubmitButton>Join session</SubmitButton>
      </form>
    </main>
  );
}
