"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { requireUser, getUserId } from "@/lib/session";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateJoinCode(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Host starts a live session for one of their services. */
export async function startSessionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const serviceId = String(formData.get("serviceId"));
  const supabase = createServiceClient();

  const { data: service } = await supabase
    .from("services")
    .select("id, owner_id, status")
    .eq("id", serviceId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!service) redirect("/dashboard");

  // Reuse an already-active session if one exists.
  const { data: existing } = await supabase
    .from("sessions")
    .select("id")
    .eq("service_id", serviceId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) redirect(`/room/${existing.id}`);

  // Insert with a unique active join code (retry on the rare collision).
  let sessionId: string | null = null;
  for (let attempt = 0; attempt < 5 && !sessionId; attempt++) {
    const join_code = generateJoinCode();
    const { data, error } = await supabase
      .from("sessions")
      .insert({
        service_id: serviceId,
        host_user_id: user.id,
        join_code,
        status: "active",
      })
      .select("id")
      .single();

    if (!error && data) {
      sessionId = data.id;
    } else if (error && error.code !== "23505") {
      // Non-uniqueness error — give up.
      break;
    }
  }

  if (!sessionId) redirect("/dashboard");

  await supabase
    .from("services")
    .update({ status: "live" })
    .eq("id", serviceId);

  // Register the host as a participant.
  await supabase.from("session_participants").insert({
    session_id: sessionId,
    user_id: user.id,
    role: "host",
  });

  revalidatePath("/dashboard");
  redirect(`/room/${sessionId}`);
}

/** Host ends a session. */
export async function endSessionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const supabase = createServiceClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, service_id, host_user_id")
    .eq("id", sessionId)
    .eq("host_user_id", user.id)
    .maybeSingle();

  if (!session) redirect("/dashboard");

  await supabase
    .from("sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", sessionId);

  await supabase
    .from("services")
    .update({ status: "offline" })
    .eq("id", session.service_id);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export interface JoinState {
  error?: string;
}

const joinSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,10}$/, "Enter a valid join code"),
  guestLabel: z.string().max(40).optional(),
});

/** A user (or guest) joins a live session by code. */
export async function joinSessionAction(
  _prev: JoinState,
  formData: FormData,
): Promise<JoinState> {
  const parsed = joinSchema.safeParse({
    code: formData.get("code"),
    guestLabel: formData.get("guestLabel") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid code" };
  }

  const supabase = createServiceClient();
  const userId = await getUserId();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, service_id, host_user_id, status")
    .eq("join_code", parsed.data.code)
    .eq("status", "active")
    .maybeSingle();

  if (!session) {
    return { error: "No active session found for that code." };
  }

  // Capacity check against the service's max_participants.
  const { data: service } = await supabase
    .from("services")
    .select("max_participants")
    .eq("id", session.service_id)
    .single();

  const { count } = await supabase
    .from("session_participants")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session.id)
    .is("left_at", null);

  if (service && count !== null && count >= service.max_participants) {
    return { error: "This session is full." };
  }

  // Add the participant. Logged-in users are deduped by the unique index;
  // guests always create a new row.
  if (userId) {
    const { data: already } = await supabase
      .from("session_participants")
      .select("id")
      .eq("session_id", session.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!already) {
      await supabase.from("session_participants").insert({
        session_id: session.id,
        user_id: userId,
        role: session.host_user_id === userId ? "host" : "viewer",
      });
    }
  } else {
    await supabase.from("session_participants").insert({
      session_id: session.id,
      guest_label: parsed.data.guestLabel ?? "Guest",
      role: "viewer",
    });
  }

  redirect(`/room/${session.id}`);
}
