# Database Changelog

A running log of every change to the Flowbot database. **Update this file whenever
`schema.sql` (or any migration) changes.** Newest entries go at the top. The goal is
that this file + `schema.sql` together fully explain the current state of the DB and
how it got there.

Format for each entry:

```
## YYYY-MM-DD — short title
- what changed (table / column / policy / function)
- why
- migration / file applied
```

---

## 2026-06-10 — Initial schema

Created the first version of the database in `schema.sql`.

**Extensions**
- `pgcrypto` — for `gen_random_uuid()`, and optional bcrypt (`crypt`/`gen_salt`).

**Enums**
- `service_type` (`live_browser`, `terminal`, `screen_share`, `file_drop`, `custom`)
- `service_status` (`offline`, `starting`, `live`, `paused`, `ended`)
- `session_status` (`active`, `ended`, `expired`)
- `participant_role` (`host`, `controller`, `viewer`)

**Tables**
- `users` — public account record (email, username, display name, flags, timestamps).
  Holds **no** secrets. Email forced lowercase; username format constrained.
- `user_secrets` — **PRIVATE**, isolated credential store keyed by `user_id`.
  Holds bcrypt `password_hash`, password-reset token hashes, lockout counters.
  No RLS policies → only the Supabase `service_role` can access it.
- `services` — a hostable service owned by a user (type, status, public flag,
  max participants, freeform `settings` jsonb).
- `sessions` — a live, joinable run of a service. Unique `join_code` among
  `active` sessions; `connection_info` jsonb for WebRTC/handshake data.
- `session_participants` — who joined a session; `user_id` nullable for guests.

**Functions / triggers**
- `set_updated_at()` + `trg_*_updated_at` triggers on all mutable tables.
- `generate_join_code(len)` — random unambiguous uppercase code (default 6 chars).
- `hash_password(text)` / `verify_password(text, text)` — optional DB-side bcrypt
  helpers. App layer (Next.js + bcrypt/bcryptjs) is the preferred place to hash.
- `current_user_id()` — reads `app.current_user_id` GUC; swap for `auth.uid()`
  if migrating to Supabase Auth.

**Security**
- RLS enabled on all five tables.
- `users`: select/update own row only.
- `user_secrets`: no policies (service_role only).
- `services`: owner full access; public services readable by anyone.
- `sessions`: host full access; participants and viewers of public services can read.
- `session_participants`: hosts see their sessions' participants; users see own rows.
- `public_profiles` view — safe read-only subset of `users` for displaying others.

**Decisions worth remembering**
- Passwords are stored as bcrypt hashes in `user_secrets`, never in `users`, so a
  bad RLS policy on the public table can't leak credentials.
- Using a custom `users` table (not `auth.users`) because we manage credentials
  ourselves per project requirement.
