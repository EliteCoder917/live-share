import Link from "next/link";
import { getCurrentUser } from "@/lib/session";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-semibold">
          flow<span className="text-brand">bot</span>
        </span>
        <nav className="flex items-center gap-3">
          {user ? (
            <Link href="/dashboard" className="btn-primary">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                Log in
              </Link>
              <Link href="/register" className="btn-primary">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center py-20 text-center">
        <h1 className="max-w-3xl text-balance text-5xl font-bold leading-tight">
          Host a live service. Let anyone join with a{" "}
          <span className="text-brand">code</span>.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-neutral-400">
          Spin up a live browser, terminal, or screen on your device and share a
          short code. The people you invite connect straight to your machine —
          no installs for them.
        </p>
        <div className="mt-10 flex gap-4">
          <Link href={user ? "/dashboard" : "/register"} className="btn-primary">
            {user ? "Go to dashboard" : "Create an account"}
          </Link>
          <Link href="/join" className="btn-ghost">
            Join with a code
          </Link>
        </div>
      </section>

      <footer className="py-8 text-center text-sm text-neutral-600">
        Flowbot — built with Next.js + Supabase
      </footer>
    </main>
  );
}
