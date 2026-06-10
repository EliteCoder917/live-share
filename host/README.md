# Flowbot host (browser server)

This runs the real Chrome windows that clients control. It connects to Supabase
Realtime and serves the live browser sessions. **End users install nothing** —
this runs once, on your server.

Two ways to run it:

| Command | Use |
|---------|-----|
| `npm run manager` | **Production.** Watches the DB and automatically serves every live `live_browser` session. Run this once on your server. |
| `SESSION_ID=<id> npm start` | Local testing. Serves a single session you name. |

## What it needs

- **Node 18+** and the ability to run headless Chrome (Puppeteer downloads its own
  Chromium on `npm install`).
- Env vars (read from `../.env.local`, or a local `host/.env`):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (used by `npm start`)
  - `SUPABASE_SERVICE_ROLE_KEY` (used by `npm run manager` to read sessions)

## Deploy on an Oracle Cloud Always-Free Ubuntu VM

1. **Create the VM:** Oracle Cloud → Compute → Instances → Create. Pick the
   **Ampere/ARM "Always Free"** shape (it has plenty of RAM for Chrome). Add your
   SSH key.

2. **SSH in and install Node + Chrome's system deps:**
   ```bash
   sudo apt update
   sudo apt install -y nodejs npm
   # libraries headless Chrome needs:
   sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
     libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
     libgbm1 libasound2 libpango-1.0-0 libcairo2
   ```

3. **Get the code + install:**
   ```bash
   git clone <your-repo> flowbot && cd flowbot/host
   npm install
   ```

4. **Add env:** create `flowbot/host/.env` with the three vars above
   (copy them from your Supabase project's API settings).

5. **Run it persistently** with pm2 so it restarts on crash/reboot:
   ```bash
   sudo npm install -g pm2
   pm2 start manager.mjs --name flowbot-manager
   pm2 save && pm2 startup    # follow the printed command
   ```

   Logs: `pm2 logs flowbot-manager`. Restart: `pm2 restart flowbot-manager`.

That's it. When a logged-in user clicks **Go live** on a Live Browser service, the
manager opens browser windows for that session within a few seconds, and everyone
with the join code can use them — no installs on their end.

## Tuning

- `WINDOWS=3` — how many windows each session starts with.
- `POLL_MS=4000` — how often the manager checks the DB for new/ended sessions.
- Frame rate/quality/viewport live in `browserSession.mjs` (`FPS`, `QUALITY`,
  `VIEWPORT`). Raise quality if your server has bandwidth to spare; lower it if
  frames stutter.

## Security note

Anyone who knows a `sessionId` can join its Realtime channel. Before going public,
enable **Supabase Realtime Authorization** so only verified session participants
can subscribe. See the main README.
