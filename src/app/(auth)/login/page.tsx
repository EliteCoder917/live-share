"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type AuthState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";

const initial: AuthState = {};

export default function LoginPage() {
  const [state, formAction] = useActionState(loginAction, initial);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mt-2 text-sm text-neutral-400">Log in to your account.</p>

      <form action={formAction} className="mt-8 space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" required className="input" />
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
            className="input"
          />
        </div>

        {state.error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {state.error}
          </p>
        )}

        <SubmitButton>Log in</SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-400">
        Need an account?{" "}
        <Link href="/register" className="text-brand hover:underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
