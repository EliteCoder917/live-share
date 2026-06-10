"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";

export interface AuthState {
  error?: string;
}

const registerSchema = z.object({
  email: z.string().email("Enter a valid email").transform((v) => v.toLowerCase()),
  username: z
    .string()
    .regex(/^[a-zA-Z0-9_]{3,32}$/, "3-32 chars: letters, numbers, underscore"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().max(80).optional(),
});

export async function registerAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    username: formData.get("username"),
    password: formData.get("password"),
    displayName: formData.get("displayName") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { email, username, password, displayName } = parsed.data;
  const supabase = createServiceClient();

  // Reject duplicates up front for a friendly message (DB unique constraints
  // are the real guard).
  const { data: existing } = await supabase
    .from("users")
    .select("id, email, username")
    .or(`email.eq.${email},username.eq.${username}`)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { error: "An account with that email or username already exists." };
  }

  const { data: user, error: insertErr } = await supabase
    .from("users")
    .insert({ email, username, display_name: displayName ?? null })
    .select("id")
    .single();

  if (insertErr || !user) {
    console.error("[register] user insert failed:", insertErr);
    return { error: "Could not create account. Please try again." };
  }

  // Store the bcrypt hash in the isolated, service-role-only secrets table.
  const password_hash = await hashPassword(password);
  const { error: secretErr } = await supabase
    .from("user_secrets")
    .insert({ user_id: user.id, password_hash });

  if (secretErr) {
    console.error("[register] user_secrets insert failed:", secretErr);
    // Roll back the orphaned user row.
    await supabase.from("users").delete().eq("id", user.id);
    return { error: "Could not create account. Please try again." };
  }

  await createSession(user.id);
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.string().email("Enter a valid email").transform((v) => v.toLowerCase()),
  password: z.string().min(1, "Enter your password"),
});

export async function loginAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { email, password } = parsed.data;
  const supabase = createServiceClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, is_active")
    .eq("email", email)
    .maybeSingle();

  const genericError = { error: "Invalid email or password." };
  if (!user || !user.is_active) return genericError;

  const { data: secret } = await supabase
    .from("user_secrets")
    .select("password_hash, locked_until")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!secret) return genericError;

  if (secret.locked_until && new Date(secret.locked_until) > new Date()) {
    return { error: "Account temporarily locked. Try again later." };
  }

  const ok = await verifyPassword(password, secret.password_hash);
  if (!ok) return genericError;

  await supabase
    .from("users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);

  await createSession(user.id);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
