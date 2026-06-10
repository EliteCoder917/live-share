// Single-session agent (handy for local testing).
// Serves ONE session given its id. For the always-on cloud deployment that
// serves every session automatically, use manager.mjs instead.
//
//   cd host && npm install
//   SESSION_ID=<id from the room page> npm start
//   # optional: WINDOWS=3 START_URL=https://example.com

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { createClient } from "@supabase/supabase-js";
import { startBrowserSession } from "./browserSession.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, ".env") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SESSION_ID = process.env.SESSION_ID || process.argv[2];

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}
if (!SESSION_ID) {
  console.error("Missing session id.  SESSION_ID=<id> npm start  (or: npm start -- <id>)");
  process.exit(1);
}

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

const realtime = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 40 } },
});

const session = await startBrowserSession(browser, realtime, SESSION_ID, {
  startWindows: Number(process.env.WINDOWS || 2),
  startUrl: process.env.START_URL,
});

console.log("Agent running. Open the room page to connect. Ctrl-C to stop.");

async function shutdown() {
  await session.stop();
  try {
    await browser.close();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
