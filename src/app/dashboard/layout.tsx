import Link from "next/link";
import { requireUser } from "@/lib/session";
import { logoutAction } from "@/app/actions/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-5xl px-6">
      <header className="flex items-center justify-between border-b border-neutral-800 py-5">
        <Link href="/dashboard" className="text-lg font-semibold">
          flow<span className="text-brand">bot</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-400">
            {user.display_name || user.username}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="btn-ghost">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="py-8">{children}</main>
    </div>
  );
}
