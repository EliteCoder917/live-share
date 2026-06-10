import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase";
import { getUserId } from "@/lib/session";
import { SERVICE_TYPE_LABELS, type Service, type Session } from "@/lib/types";
import { RoomClient } from "./RoomClient";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceClient();
  const userId = await getUserId();

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();
  const sess = session as Session;

  const { data: service } = await supabase
    .from("services")
    .select("*")
    .eq("id", sess.service_id)
    .single();
  const svc = service as Service;

  const isHost = !!userId && userId === sess.host_user_id;
  const ended = sess.status !== "active";

  return (
    <div className="mx-auto max-w-5xl px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 py-5">
        <div>
          <Link href="/" className="text-lg font-semibold">
            flow<span className="text-brand">bot</span>
          </Link>
          <p className="mt-1 text-sm text-neutral-400">
            {svc.name} ·{" "}
            <span className="text-brand">{SERVICE_TYPE_LABELS[svc.type]}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-neutral-500">Join code</p>
          <p className="font-mono text-2xl tracking-widest text-brand">
            {sess.join_code}
          </p>
        </div>
      </header>

      {ended ? (
        <div className="card mt-8 text-center text-neutral-400">
          This session has ended.
          <div className="mt-4">
            <Link href="/" className="btn-ghost">
              Back home
            </Link>
          </div>
        </div>
      ) : (
        <RoomClient
          sessionId={sess.id}
          isHost={isHost}
          selfId={userId ?? `guest-${Math.random().toString(36).slice(2, 10)}`}
        />
      )}
    </div>
  );
}
