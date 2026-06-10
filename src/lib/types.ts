// Row shapes mirroring supabase/schema.sql. Keep in sync with the DB.

export type ServiceType =
  | "live_browser"
  | "terminal"
  | "screen_share"
  | "file_drop"
  | "custom";

export type ServiceStatus =
  | "offline"
  | "starting"
  | "live"
  | "paused"
  | "ended";

export type SessionStatus = "active" | "ended" | "expired";

export type ParticipantRole = "host" | "controller" | "viewer";

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  type: ServiceType;
  status: ServiceStatus;
  is_public: boolean;
  max_participants: number;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  service_id: string;
  host_user_id: string;
  join_code: string;
  status: SessionStatus;
  connection_info: Record<string, unknown>;
  started_at: string;
  expires_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionParticipant {
  id: string;
  session_id: string;
  user_id: string | null;
  guest_label: string | null;
  role: ParticipantRole;
  joined_at: string;
  left_at: string | null;
}

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  live_browser: "Live Browser",
  terminal: "Shared Terminal",
  screen_share: "Screen Share",
  file_drop: "File Drop",
  custom: "Custom",
};
