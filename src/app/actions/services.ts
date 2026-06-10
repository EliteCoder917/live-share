"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import type { ServiceType } from "@/lib/types";

const serviceTypes: [ServiceType, ...ServiceType[]] = [
  "live_browser",
  "terminal",
  "screen_share",
  "file_drop",
  "custom",
];

export interface ServiceFormState {
  error?: string;
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
  type: z.enum(serviceTypes),
  isPublic: z.boolean(),
  maxParticipants: z.coerce.number().int().min(1).max(100),
});

export async function createServiceAction(
  _prev: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const user = await requireUser();

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    type: formData.get("type"),
    isPublic: formData.get("isPublic") === "on",
    maxParticipants: formData.get("maxParticipants") ?? 5,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("services").insert({
    owner_id: user.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    type: parsed.data.type,
    is_public: parsed.data.isPublic,
    max_participants: parsed.data.maxParticipants,
  });

  if (error) return { error: "Could not create service. Please try again." };

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function deleteServiceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const serviceId = String(formData.get("serviceId"));

  const supabase = createServiceClient();
  // Ownership enforced in the WHERE clause since service-role bypasses RLS.
  await supabase
    .from("services")
    .delete()
    .eq("id", serviceId)
    .eq("owner_id", user.id);

  revalidatePath("/dashboard");
}
