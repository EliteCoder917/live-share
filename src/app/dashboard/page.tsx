import Link from "next/link";
import { requireUser } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase";
import { SERVICE_TYPE_LABELS, type Service, type Session } from "@/lib/types";
import { startSessionAction, endSessionAction } from "@/app/actions/sessions";
import { deleteServiceAction } from "@/app/actions/services";

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = createServiceClient();

  const { data: services } = await supabase
    .from("services")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  const { data: activeSessions } = await supabase
    .from("sessions")
    .select("*")
    .eq("host_user_id", user.id)
    .eq("status", "active");

  const sessionByService = new Map<string, Session>();
  for (const s of (activeSessions as Session[]) ?? []) {
    sessionByService.set(s.service_id, s);
  }

  const list = (services as Service[]) ?? [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your services</h1>
        <Link href="/dashboard/services/new" className="btn-primary">
          + New service
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="card mt-8 text-center text-neutral-400">
          <p>You haven&apos;t created any services yet.</p>
          <Link
            href="/dashboard/services/new"
            className="btn-primary mt-4 inline-flex"
          >
            Create your first service
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {list.map((service) => {
            const active = sessionByService.get(service.id);
            return (
              <div key={service.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold">{service.name}</h2>
                    <p className="text-xs uppercase tracking-wide text-brand">
                      {SERVICE_TYPE_LABELS[service.type]}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      active
                        ? "bg-green-500/15 text-green-400"
                        : "bg-neutral-700/40 text-neutral-400"
                    }`}
                  >
                    {active ? "live" : "offline"}
                  </span>
                </div>

                {service.description && (
                  <p className="mt-2 text-sm text-neutral-400">
                    {service.description}
                  </p>
                )}

                <p className="mt-3 text-xs text-neutral-500">
                  Up to {service.max_participants} participant
                  {service.max_participants === 1 ? "" : "s"} ·{" "}
                  {service.is_public ? "public" : "private"}
                </p>

                {active && (
                  <p className="mt-3 rounded-lg bg-neutral-800 px-3 py-2 text-sm">
                    Join code:{" "}
                    <span className="font-mono text-lg tracking-widest text-brand">
                      {active.join_code}
                    </span>
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {active ? (
                    <>
                      <Link href={`/room/${active.id}`} className="btn-primary">
                        Open room
                      </Link>
                      <form action={endSessionAction}>
                        <input type="hidden" name="sessionId" value={active.id} />
                        <button className="btn-ghost">End session</button>
                      </form>
                    </>
                  ) : (
                    <form action={startSessionAction}>
                      <input
                        type="hidden"
                        name="serviceId"
                        value={service.id}
                      />
                      <button className="btn-primary">Go live</button>
                    </form>
                  )}
                  <form action={deleteServiceAction}>
                    <input type="hidden" name="serviceId" value={service.id} />
                    <button className="btn-ghost text-red-400">Delete</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
