// Per-session browser serving logic, shared by the single-session CLI (agent.mjs)
// and the always-on manager (manager.mjs).
//
// Given a Puppeteer browser and a Supabase Realtime client, this serves ONE
// live session: it opens browser windows, streams the ones being watched as
// throttled JPEG frames, and applies incoming mouse/keyboard/navigation input.

export const VIEWPORT = { width: 1024, height: 640 };
const QUALITY = 42;
const FPS = 10; // frames/sec sent per watched window (decoupled from capture rate)
const BUTTON = { 0: "left", 1: "middle", 2: "right" };

export async function startBrowserSession(browser, realtime, sessionId, opts = {}) {
  const startWindows = Number(opts.startWindows ?? 2);
  const startUrl = opts.startUrl || "https://www.google.com";
  const log = (...a) => console.log(`[${sessionId.slice(0, 8)}]`, ...a);

  /** windowId -> { page, cdp, streaming, latest, title, url } */
  const windows = new Map();
  let nextId = 1;
  let closed = false;

  const channel = realtime.channel(`room:${sessionId}`, {
    config: {
      broadcast: { self: false },
      presence: { key: `agent-${sessionId}` },
    },
  });

  function send(kind, extra = {}) {
    channel.send({ type: "broadcast", event: "msg", payload: { kind, ...extra } });
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

  async function createWindow(url = startUrl) {
    const id = "w" + nextId++;
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    const cdp = await page.createCDPSession();
    const rec = { page, cdp, streaming: false, latest: null, title: "", url };
    windows.set(id, rec);

    cdp.on("Page.screencastFrame", async ({ data, sessionId: sid }) => {
      rec.latest = data; // keep only the newest frame; the timer sends it
      try {
        await cdp.send("Page.screencastFrameAck", { sessionId: sid });
      } catch {}
    });

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
    log("opened window", id, "->", rec.url);
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
      .then(() => log("streaming", id))
      .catch(() => {
        r.streaming = false;
      });
  }

  async function stopStream(id) {
    const r = windows.get(id);
    if (!r || !r.streaming) return;
    r.streaming = false;
    r.latest = null;
    try {
      await r.cdp.send("Page.stopScreencast");
    } catch {}
    log("stopped", id);
  }

  async function closeWindow(id) {
    const r = windows.get(id);
    if (!r) return;
    await stopStream(id);
    await r.page.close().catch(() => {});
    windows.delete(id);
    sendWindows();
  }

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
      /* page navigating/closing — ignore */
    }
  }

  // Presence is the source of truth for which windows have viewers (stops
  // streams nobody watches); explicit 'watch' starts a stream immediately.
  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    const viewed = new Set();
    for (const arr of Object.values(state)) {
      for (const p of arr) if (p.viewing) viewed.add(p.viewing);
    }
    for (const id of windows.keys()) {
      if (viewed.has(id)) startStream(id);
      else stopStream(id);
    }
  });

  channel.on("broadcast", { event: "msg" }, async ({ payload: m }) => {
    if (m.kind === "list") sendWindows();
    else if (m.kind === "watch") startStream(m.windowId);
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

  // Fixed-rate sender: at most FPS frames/sec per streaming window, newest only.
  const frameTimer = setInterval(() => {
    for (const [id, r] of windows) {
      if (r.streaming && r.latest) {
        channel.send({
          type: "broadcast",
          event: "frame",
          payload: { windowId: id, data: r.latest },
        });
        r.latest = null;
      }
    }
  }, Math.round(1000 / FPS));

  await new Promise((resolve) => {
    channel.subscribe(async (state) => {
      if (state === "SUBSCRIBED") {
        await channel.track({ id: `agent-${sessionId}`, role: "agent", viewing: null });
        for (let i = 0; i < startWindows; i++) await createWindow();
        sendWindows();
        log(`online — serving ${windows.size} window(s)`);
        resolve();
      }
    });
  });

  return {
    sessionId,
    async stop() {
      if (closed) return;
      closed = true;
      clearInterval(frameTimer);
      for (const id of [...windows.keys()]) await closeWindow(id);
      try {
        await realtime.removeChannel(channel);
      } catch {}
      log("session stopped");
    },
  };
}
