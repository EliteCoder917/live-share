// Always-on browser manager — runs once on your server (e.g. an Oracle Cloud
// Always-Free Ubuntu VM). It watches the database for live `live_browser`
// sessions and automatically serves each one. Hosts and joiners install
// nothing; they just use the web app.
//
//   cd host && npm install
//   npm run manager
//   # keep it running with pm2 / systemd in production (see host/README.md)

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
import { startBrowserSession } from "./browserSession.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, ".env") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.POLL_MS || 4000);
const WINDOWS = Number(process.env.WINDOWS || 2);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. " +
      "The manager needs the service-role key to read sessions.",
  );
  process.exit(1);
}

// Service-role client: used both for DB polling and as the Realtime transport
// (it runs on a trusted server, never in a browser).
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  // Node < 22 has no global WebSocket; supply one for Realtime.
  realtime: { transport: WebSocket, params: { eventsPerSecond: 40 } },
});

const browser = await puppeteer.launch({
  headless: true,
  // Lean flags for small (1 GB) VMs — cut GPU/extensions/background work.
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--mute-audio",
    "--no-first-run",
  ],
});

/** sessionId -> session handle from startBrowserSession */
const active = new Map();
let stopping = false;

async function tick() {
  if (stopping) return;
  // Active live_browser sessions = sessions.status 'active' joined to a
  // live_browser service.
  const { data, error } = await supabase
    .from("sessions")
    .select("id, service:services!inner(type)")
    .eq("status", "active")
    .eq("services.type", "live_browser");

  if (error) {
    console.error("poll error:", error.message);
    return;
  }

  const wanted = new Set((data ?? []).map((s) => s.id));

  // Start newly-live sessions.
  for (const id of wanted) {
    if (!active.has(id)) {
      console.log("serving new session", id);
      active.set(id, "starting"); // reserve slot to avoid double-start
      try {
        const handle = await startBrowserSession(browser, supabase, id, {
          startWindows: WINDOWS,
        });
        active.set(id, handle);
      } catch (e) {
        console.error("failed to start", id, e?.message);
        active.delete(id);
      }
    }
  }

  // Tear down sessions that ended.
  for (const [id, handle] of active) {
    if (!wanted.has(id) && handle !== "starting") {
      console.log("ending session", id);
      active.delete(id);
      await handle.stop().catch(() => {});
    }
  }
}

console.log(`Flowbot manager online. Polling every ${POLL_MS}ms.`);
await tick();
const timer = setInterval(tick, POLL_MS);

async function shutdown() {
  stopping = true;
  clearInterval(timer);
  console.log("\nShutting down manager…");
  for (const [, handle] of active) {
    if (handle !== "starting") await handle.stop().catch(() => {});
  }
  try {
    await browser.close();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
