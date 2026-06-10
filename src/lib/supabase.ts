import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "./env";

// Server-side Supabase client using the SERVICE ROLE key.
// This bypasses Row Level Security, so all authorization MUST be enforced in
// our own code (via the authenticated session). Never import this into a
// Client Component — the "server-only" guard above will error if you try.
export function createServiceClient() {
  const { supabaseServiceRoleKey } = serverEnv();
  return createClient(publicEnv.supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
