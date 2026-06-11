"use client";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "./env";

// Browser Supabase client using the public ANON key. We only use it for
// Realtime (presence + broadcast signaling) in session rooms — all data
// mutations go through server actions. A single shared instance avoids opening
// multiple websocket connections.
let client: ReturnType<typeof createClient> | null = null;

export function getBrowserSupabase() {
  if (!client) {
    client = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
      auth: { persistSession: false },
      // Default is 10 events/sec, which throttles live frames to a crawl.
      // Raise it so streamed frames + input get through.
      realtime: { params: { eventsPerSecond: 40 } },
    });
  }
  return client;
}
