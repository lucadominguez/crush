// D1 row types — mirror db/schema.sql exactly.
// SQLite conventions: booleans are 0|1 integers, timestamps are ISO-8601 TEXT,
// JSON columns are TEXT (parse at the edge).

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileRow = {
  id: string;
  user_id: string;
  name: string;
  handle: string;
  emoji: string;
  avatar_url: string | null;
  dob: string | null;
  school: string | null;
  city: string | null;
  phone_e164: string | null;
  instagram_handle: string | null;
  instagram_name: string | null;
  instagram_avatar: string | null;
  instagram_followers: number | null;
  instagram_verified_at: string | null;
  instagram_verify_code: string | null;
  handle_confirmed_at: string | null;
  referral_code: string | null;
  referred_by: string | null;
  crush_slots: number;
  hint_credits: number;
  god_mode_expires_at: string | null;
  trust_score: number;
  push_enabled: number;
  created_at: string;
  updated_at: string;
};

export type CrushRow = {
  id: string;
  owner_id: string;
  target_handle: string;
  created_at: string;
};

export type MatchRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
  expires_at: string | null;
  expiry_warned_at: string | null;
  last_message_at: string | null;
  saved: number;
};

export type MessageRow = {
  id: string;
  match_id: string;
  from_user_id: string;
  text: string;
  client_id: string | null;
  created_at: string;
};

export type GroupChatRow = {
  id: string;
  name: string;
  emoji: string;
  created_by: string;
  last_message_at: string | null;
  created_at: string;
};

export type GroupMessageRow = {
  id: string;
  group_id: string;
  from_user_id: string;
  text: string;
  client_id: string | null;
  created_at: string;
};

export type PollRow = {
  id: string;
  question: string;
  option_handles: string; // JSON array
  created_by: string | null;
  school: string | null;
  question_id: string | null;
  active_date: string | null;
  created_at: string;
};

export type PollVoteRow = {
  id: string;
  poll_id: string;
  user_id: string;
  voted_handle: string;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  payload: string; // JSON
  read_at: string | null;
  created_at: string;
};

export type QuizAnswersRow = {
  id: string;
  user_id: string;
  vibe: string | null;
  sleep: string | null;
  texting: string | null;
  weekend: string | null;
  flag: string | null;
  created_at: string;
  updated_at: string;
};

export type HintRow = {
  id: string;
  user_id: string;
  target_handle: string;
  hint_index: number;
  hint_text: string;
  created_at: string;
};

export type PurchaseRow = {
  id: string;
  user_id: string;
  product: string;
  amount_cents: number;
  metadata: string; // JSON
  created_at: string;
};

export type WeeklySuperlativeRow = {
  id: string;
  school: string | null;
  week_start: string;
  question_id: string | null;
  question: string;
  winner_handle: string;
  votes: number;
  created_at: string;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
