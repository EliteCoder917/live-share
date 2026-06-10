"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction, type AuthState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";

const initial: AuthState = {};

export default function RegisterPage() {
  const [state, formAction] = useActionState(registerAction, initial);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Start hosting live services in minutes.
      </p>

      <form action={formAction} className="mt-8 space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            placeholder="3-32 chars, letters/numbers/_"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="displayName">
            Display name <span className="text-neutral-500">(optional)</span>
          </label>
          <input id="displayName" name="displayName" type="text" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            className="input"
          />
        </div>

        {state.error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {state.error}
          </p>
        )}

        <SubmitButton>Create account</SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-400">
        Already have an account?{" "}
        <Link href="/login" className="text-brand hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
