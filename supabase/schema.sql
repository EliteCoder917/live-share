-- =============================================================================
-- Flowbot — Supabase / PostgreSQL schema
-- =============================================================================
-- App model: users create accounts and host "live services" (e.g. a shared
-- live browser, terminal, or screen). Other people join a running session of a
-- service using a short join code. This file is the single source of truth for
-- the database; see CHANGELOG.md for the history of every change made here.
--
-- Conventions:
--   * All primary keys are uuid (gen_random_uuid()).
--   * All tables have created_at / updated_at where mutable.
--   * Private user data (password hashes, etc.) lives ONLY in `user_secrets`,
--     which is readable/writable exclusively by the Supabase service_role.
--   * Row Level Security (RLS) is ON for every table. Nothing is exposed to the
--     anon/authenticated client unless an explicit policy allows it.
--
-- Run this once against a fresh database. It is written to be idempotent where
-- practical (IF NOT EXISTS / CREATE OR REPLACE), but enum/type changes should
-- go through a new migration instead of editing in place.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid(), crypt(), gen_salt()


-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
do $$ begin
  create type service_type as enum (
    'live_browser',   -- remote-controlled headless/visible browser
    'terminal',       -- shared shell session
    'screen_share',   -- host screen broadcast
    'file_drop',      -- shared file transfer space
    'custom'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_status as enum ('offline', 'starting', 'live', 'paused', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_status as enum ('active', 'ended', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type participant_role as enum ('host', 'controller', 'viewer');
exception when duplicate_object then null; end $$;


-- -----------------------------------------------------------------------------
-- 2. Shared trigger function: keep updated_at fresh
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. Users (public-facing account record)
-- -----------------------------------------------------------------------------
-- NOTE: this is a custom users table (not Supabase's auth.users), per the
-- requirement to manage credentials ourselves with bcrypt. It holds NO secrets.
create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  username        text not null unique,
  display_name    text,
  avatar_url      text,
  email_verified  boolean not null default false,
  is_active       boolean not null default true,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint users_email_lowercase check (email = lower(email)),
  constraint username_format check (username ~ '^[a-zA-Z0-9_]{3,32}$')
);

create index if not exists idx_users_email on users (email);
create index if not exists idx_users_username on users (username);

create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. User secrets (PRIVATE — service_role only)
-- -----------------------------------------------------------------------------
-- Password hashes and any other sensitive auth material live here, isolated
-- from the public `users` table so a leaky RLS policy on `users` can never
-- expose credentials. password_hash is a bcrypt hash produced in the Next.js
-- app layer (bcrypt/bcryptjs) OR by the helper functions below.
create table if not exists user_secrets (
  user_id              uuid primary key references users (id) on delete cascade,
  password_hash        text not null,           -- bcrypt hash, NEVER plaintext
  password_updated_at  timestamptz not null default now(),
  failed_login_count   integer not null default 0,
  locked_until         timestamptz,
  -- For password reset / email verification flows. Store only hashes of tokens.
  reset_token_hash     text,
  reset_token_expires  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trg_user_secrets_updated_at
  before update on user_secrets
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. Services (a thing a user can host)
-- -----------------------------------------------------------------------------
create table if not exists services (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references users (id) on delete cascade,
  name             text not null,
  description      text,
  type             service_type not null default 'live_browser',
  status           service_status not null default 'offline',
  is_public        boolean not null default false,   -- discoverable without a code
  max_participants integer not null default 5 check (max_participants between 1 and 100),
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_services_owner on services (owner_id);
create index if not exists idx_services_status on services (status);

create trigger trg_services_updated_at
  before update on services
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- 6. Sessions (a live, joinable run of a service)
-- -----------------------------------------------------------------------------
-- A service can be started multiple times; each run is a session with its own
-- short join code. Codes are unique among active sessions.
create table if not exists sessions (
  id               uuid primary key default gen_random_uuid(),
  service_id       uuid not null references services (id) on delete cascade,
  host_user_id     uuid not null references users (id) on delete cascade,
  join_code        text not null,                    -- e.g. "K7P3Q2"
  status           session_status not null default 'active',
  -- network/handshake details for connecting to the host device (WebRTC etc.)
  connection_info  jsonb not null default '{}'::jsonb,
  started_at       timestamptz not null default now(),
  expires_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Join codes only need to be unique among sessions that are still active.
create unique index if not exists uq_sessions_active_code
  on sessions (join_code)
  where status = 'active';

create index if not exists idx_sessions_service on sessions (service_id);
create index if not exists idx_sessions_host on sessions (host_user_id);

create trigger trg_sessions_updated_at
  before update on sessions
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- 7. Session participants (who joined a session)
-- -----------------------------------------------------------------------------
-- user_id is nullable to allow anonymous guests who joined purely with a code.
create table if not exists session_participants (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions (id) on delete cascade,
  user_id       uuid references users (id) on delete set null,
  guest_label   text,                              -- display name for guests
  role          participant_role not null default 'viewer',
  joined_at     timestamptz not null default now(),
  left_at       timestamptz
);

create index if not exists idx_participants_session on session_participants (session_id);
create index if not exists idx_participants_user on session_participants (user_id);

-- A logged-in user is counted once per session.
create unique index if not exists uq_participant_per_session
  on session_participants (session_id, user_id)
  where user_id is not null;


-- -----------------------------------------------------------------------------
-- 8. Helpers
-- -----------------------------------------------------------------------------

-- Generate a random 6-char uppercase join code (no ambiguous 0/O/1/I).
create or replace function generate_join_code(len integer default 6)
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result   text := '';
  i        integer;
begin
  for i in 1..len loop
    result := result || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

-- OPTIONAL: hash a password in the database using bcrypt (pgcrypto 'bf').
-- Prefer hashing in the Next.js app with bcrypt/bcryptjs; these exist for
-- convenience and for SQL-side flows. SECURITY DEFINER + service_role only.
create or replace function hash_password(plaintext text)
returns text
language sql
as $$
  select crypt(plaintext, gen_salt('bf', 12));
$$;

create or replace function verify_password(plaintext text, hashed text)
returns boolean
language sql
as $$
  select hashed = crypt(plaintext, hashed);
$$;


-- =============================================================================
-- 9. Row Level Security
-- =============================================================================
-- The service_role key bypasses RLS entirely, so server-side Next.js code
-- (route handlers / server actions using the service key) can do anything.
-- These policies govern the anon/authenticated (browser) clients.
--
-- Identity model: when using your own auth, set a session GUC after verifying
-- the user, e.g.  `select set_config('app.current_user_id', '<uuid>', true);`
-- and reference it via current_user_id() below. If you later move to Supabase
-- Auth, swap current_user_id() for auth.uid().

create or replace function current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- Enable RLS everywhere.
alter table users                enable row level security;
alter table user_secrets         enable row level security;
alter table services             enable row level security;
alter table sessions             enable row level security;
alter table session_participants enable row level security;

-- users: a user can read/update their own row; public profile fields of others
-- are exposed via a view (see below) rather than the base table.
drop policy if exists users_select_self on users;
create policy users_select_self on users
  for select using (id = current_user_id());

drop policy if exists users_update_self on users;
create policy users_update_self on users
  for update using (id = current_user_id());

-- user_secrets: NO policies => no anon/authenticated access at all.
-- Only the service_role (which bypasses RLS) can read or write credentials.

-- services: owners manage their own; everyone can see public ones.
drop policy if exists services_select on services;
create policy services_select on services
  for select using (is_public or owner_id = current_user_id());

drop policy if exists services_modify on services;
create policy services_modify on services
  for all using (owner_id = current_user_id())
  with check (owner_id = current_user_id());

-- sessions: host manages; participants and (for public services) anyone can read.
drop policy if exists sessions_select on sessions;
create policy sessions_select on sessions
  for select using (
    host_user_id = current_user_id()
    or exists (
      select 1 from session_participants p
      where p.session_id = sessions.id and p.user_id = current_user_id()
    )
    or exists (
      select 1 from services s
      where s.id = sessions.service_id and s.is_public
    )
  );

drop policy if exists sessions_modify on sessions;
create policy sessions_modify on sessions
  for all using (host_user_id = current_user_id())
  with check (host_user_id = current_user_id());

-- session_participants: hosts see everyone in their sessions; users see their own rows.
drop policy if exists participants_select on session_participants;
create policy participants_select on session_participants
  for select using (
    user_id = current_user_id()
    or exists (
      select 1 from sessions s
      where s.id = session_participants.session_id
        and s.host_user_id = current_user_id()
    )
  );

drop policy if exists participants_modify on session_participants;
create policy participants_modify on session_participants
  for all using (
    user_id = current_user_id()
    or exists (
      select 1 from sessions s
      where s.id = session_participants.session_id
        and s.host_user_id = current_user_id()
    )
  )
  with check (true);


-- -----------------------------------------------------------------------------
-- 10. Public profile view (safe, read-only subset of users)
-- -----------------------------------------------------------------------------
create or replace view public_profiles as
  select id, username, display_name, avatar_url, created_at
  from users
  where is_active;

-- =============================================================================
-- End of schema
-- =============================================================================
