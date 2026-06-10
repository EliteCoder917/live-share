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
- **Live rooms** use the Supabase **anon** client in the browser
  (`src/lib/supabase-browser.ts`) purely for Realtime: presence (who's in the
  room) and broadcast signaling (WebRTC offer/answer/ICE). Media flows P2P.

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
4. As host, click **Share** and pick a screen/tab/window — viewers see it live.
5. Share the code; others go to `/join`, enter it, and watch in real time.

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

- The room currently streams **host → viewers** (one-way video). Remote *control*
  (forwarding viewer input back to the host's browser) would add an RTCDataChannel
  plus a host-side agent (e.g. Puppeteer) — scaffolding is in `RoomClient.tsx`.
- WebRTC uses a public Google STUN server. For restrictive networks, add a TURN
  server to `ICE_CONFIG` in `RoomClient.tsx`.
- Every database change is logged in [`supabase/CHANGELOG.md`](supabase/CHANGELOG.md).
