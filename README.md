# Flowbot

Host live services and let anyone join with a code. Create an account, spin up a
service (live browser, screen share, terminal, file drop), go live, and share the
short join code. Viewers connect peer-to-peer over WebRTC — no install for them.

Built with **Next.js 15 (App Router) + TypeScript + Tailwind + Supabase**.

## Stack & architecture

- **Auth** is custom (not Supabase Auth). Passwords are bcrypt-hashed in the app
  and stored in an isolated `user_secrets` table that only the service-role key
  can touch. Sessions are signed JWTs in an httpOnly cookie (`jose`).
- **Data access** is server-side only, via the Supabase **service-role** client
  (`src/lib/supabase.ts`). It bypasses RLS, so authorization is enforced in our
  server actions using the logged-in session. RLS policies in `schema.sql` are
  defense-in-depth for any anon-key access.
- **Live rooms** are a remote-browser-server model:
  - The **host** runs a Node agent (`host/agent.mjs`) on their device. It launches
    real Chrome windows via Puppeteer, streams each as JPEG frames (Chrome
    DevTools screencast), and applies mouse/keyboard/navigation input.
  - **Clients** (the `/room/[id]` page) list the hosted windows, render the live
    frames of the one they pick, and forward input back. Multiple clients can each
    drive a different window at once — the host device is the server.
  - Both sides connect through a Supabase Realtime channel (`room:<sessionId>`),
    which relays the window list, frames, input, and presence. No inbound ports or
    NAT traversal needed; both make outbound connections to Supabase.

## Setup

1. **Create a Supabase project**, then run the schema:
   - Open the SQL editor and paste/run [`supabase/schema.sql`](supabase/schema.sql).
   - Enable Realtime (it's on by default) — the rooms use broadcast + presence,
     which need no table configuration.

2. **Configure env:**
   ```bash
   cp .env.local.example .env.local
   ```
   Fill in from Supabase → Project Settings → API:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only — never expose)
   - `SESSION_SECRET` → `openssl rand -base64 48`

3. **Install & run:**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000.

## How to use

1. Register → you land on the dashboard.
2. **New service** → pick a type and capacity.
3. **Go live** → a join code is generated and the room opens.
4. As host, start the agent on your device (the room page shows the exact command):
   ```bash
   cd host
   npm install            # first time only; downloads Chromium
   SESSION_ID=<id> npm start
   # optional: WINDOWS=3 START_URL=https://example.com
   ```
5. Share the code; others go to `/join`, enter it, pick a window from the sidebar,
   and actually use that browser — clicking, typing, scrolling, navigating — all
   running on your device.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing |
| `/register`, `/login` | Custom auth |
| `/dashboard` | Manage services, go live / end sessions |
| `/dashboard/services/new` | Create a service |
| `/join` | Enter a join code |
| `/room/[id]` | Live room (presence + WebRTC) |

## Notes / next steps

- **Transport.** Frames currently flow through Supabase Realtime broadcast as
  base64 JPEG, throttled by viewport (1024×640) and quality (45) in
  `host/agent.mjs`. That's great for getting started but will hit Realtime
  rate/size limits with many windows or clients. To scale, move frame transport to
  WebRTC video (host agent as a peer) or a dedicated WebSocket relay, keeping the
  Supabase channel just for signaling/coordination.
- **Security.** Anyone who learns a `sessionId` can join its channel. Harden by
  enabling Supabase Realtime Authorization (RLS on the `realtime.messages` schema)
  so only authenticated participants of a session can subscribe.
- **Host agent** lives in [`host/`](host/) with its own `package.json` (Puppeteer
  is heavy), so the web app stays lean.
- Every database change is logged in [`supabase/CHANGELOG.md`](supabase/CHANGELOG.md).
