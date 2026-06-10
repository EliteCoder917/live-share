// Flowbot host agent
// -------------------
// Runs on the HOST device. Launches real Chrome windows via Puppeteer and
// serves them to connected clients through a Supabase Realtime channel:
//   * streams each window as JPEG frames (Chrome DevTools screencast)
//   * applies mouse / keyboard / navigation input coming back from clients
//
// One agent serves one live session. Multiple clients can each control a
// different window at the same time; the host device is the "server".
//
// Usage:
//   cd host && npm install
//   SESSION_ID=<id from the room page> npm start
//   # optional: WINDOWS=3 START_URL=https://example.com

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Reuse the web app's env, then allow a local host/.env to override.
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, ".env") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SESSION_ID = process.env.SESSION_ID || process.argv[2];
const START_WINDOWS = Number(process.env.WINDOWS || 2);
const START_URL = process.env.START_URL || "https://www.google.com";

// Keep frames small enough for Realtime broadcast payloads.
const VIEWPORT = { width: 1024, height: 640 };
const QUALITY = 45;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Run from the project so ../.env.local is found, or add host/.env.",
  );
  process.exit(1);
}
if (!SESSION_ID) {
  console.error(
    "Missing session id.\n  SESSION_ID=<id> npm start   (or: npm start -- <id>)\n" +
      "Find the id on the room page after you click 'Go live'.",
  );
  process.exit(1);
}

const browser = await puppeteer.launch({
  headless: true,
  defaultViewport: VIEWPORT,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

/** windowId -> { page, cdp, streaming, title, url } */
const windows = new Map();
let nextId = 1;

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false },
});
const channel = supabase.channel(`room:${SESSION_ID}`, {
  config: { broadcast: { self: false }, presence: { key: "host-agent" } },
});

function send(kind, extra = {}) {
  channel.send({ type: "broadcast", event: "msg", payload: { kind, ...extra } });
}
function sendFrame(windowId, data) {
  channel.send({ type: "broadcast", event: "frame", payload: { windowId, data } });
}
function windowList() {
  return [...windows.entries()].map(([id, r]) => ({
    id,
    title: r.title || r.url,
    url: r.url,
  }));
}
function sendWindows() {
  send("windows", { windows: windowList() });
}

async function createWindow(url = START_URL) {
  const id = "w" + nextId++;
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const cdp = await page.createCDPSession();

  cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
    // Must ack or Chrome stops sending frames.
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId });
    } catch {}
    sendFrame(id, data);
  });

  const rec = { page, cdp, streaming: false, title: "", url };
  windows.set(id, rec);

  page.on("framenavigated", async (frame) => {
    if (frame === page.mainFrame()) {
      rec.url = page.url();
      try {
        rec.title = await page.title();
      } catch {}
      sendWindows();
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  rec.url = page.url();
  try {
    rec.title = await page.title();
  } catch {}
  return id;
}

async function startStream(id) {
  const r = windows.get(id);
  if (!r || r.streaming) return;
  r.streaming = true;
  await r.cdp
    .send("Page.startScreencast", {
      format: "jpeg",
      quality: QUALITY,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1,
    })
    .catch(() => {
      r.streaming = false;
    });
}

async function stopStream(id) {
  const r = windows.get(id);
  if (!r || !r.streaming) return;
  r.streaming = false;
  try {
    await r.cdp.send("Page.stopScreencast");
  } catch {}
}

// Only stream windows that currently have a viewer (saves bandwidth/CPU).
function reconcileStreams(viewedIds) {
  for (const id of windows.keys()) {
    if (viewedIds.has(id)) startStream(id);
    else stopStream(id);
  }
}

async function closeWindow(id) {
  const r = windows.get(id);
  if (!r) return;
  await stopStream(id);
  await r.page.close().catch(() => {});
  windows.delete(id);
  sendWindows();
}

const BUTTON = { 0: "left", 1: "middle", 2: "right" };

async function handleInput(m) {
  const r = windows.get(m.windowId);
  if (!r) return;
  const page = r.page;
  try {
    switch (m.type) {
      case "move":
        await page.mouse.move(m.x, m.y);
        break;
      case "down":
        await page.mouse.move(m.x, m.y);
        await page.mouse.down({ button: BUTTON[m.button] || "left" });
        break;
      case "up":
        await page.mouse.up({ button: BUTTON[m.button] || "left" });
        break;
      case "wheel":
        await page.mouse.wheel({ deltaX: m.deltaX || 0, deltaY: m.deltaY || 0 });
        break;
      case "key":
        if (m.text && m.text.length === 1 && !m.ctrl && !m.meta) {
          await page.keyboard.type(m.text);
        } else if (m.key) {
          await page.keyboard.press(m.key).catch(() => {});
        }
        break;
      case "navigate":
        if (m.url) {
          const url = /^https?:\/\//.test(m.url) ? m.url : `https://${m.url}`;
          await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
        }
        break;
      case "back":
        await page.goBack().catch(() => {});
        break;
      case "forward":
        await page.goForward().catch(() => {});
        break;
      case "reload":
        await page.reload().catch(() => {});
        break;
    }
  } catch {
    /* input on a closing/navigating page — ignore */
  }
}

channel.on("presence", { event: "sync" }, () => {
  const state = channel.presenceState();
  const viewed = new Set();
  for (const arr of Object.values(state)) {
    for (const p of arr) if (p.viewing) viewed.add(p.viewing);
  }
  reconcileStreams(viewed);
});

channel.on("broadcast", { event: "msg" }, async ({ payload: m }) => {
  if (m.kind === "list") sendWindows();
  else if (m.kind === "open-window") {
    await createWindow(m.url || undefined);
    sendWindows();
  } else if (m.kind === "close-window") {
    await closeWindow(m.windowId);
  }
});

channel.on("broadcast", { event: "input" }, ({ payload }) => {
  handleInput(payload);
});

await channel.subscribe(async (state) => {
  if (state === "SUBSCRIBED") {
    await channel.track({ id: "host-agent", role: "agent", viewing: null });
    for (let i = 0; i < START_WINDOWS; i++) await createWindow();
    sendWindows();
    console.log(
      `Host agent online for session ${SESSION_ID} — serving ${windows.size} window(s).`,
    );
    console.log("Clients can now connect from the room page. Ctrl-C to stop.");
  }
});

async function shutdown() {
  console.log("\nShutting down…");
  try {
    await supabase.removeChannel(channel);
  } catch {}
  try {
    await browser.close();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
