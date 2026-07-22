-- Crush Connect — D1 (SQLite) schema
-- Ported 2026-07-19 from 27 Supabase/Postgres migrations (see supabase/migrations/
-- kept for reference, and BACKEND.md §4-5 for the source-of-truth outline).
--
-- Porting conventions:
--   uuid        -> TEXT, generated app-side via crypto.randomUUID()
--   timestamptz -> TEXT ISO-8601 UTC (lexicographically sortable)
--   boolean     -> INTEGER 0/1
--   jsonb       -> TEXT (JSON)
--   text[]      -> TEXT (JSON array)
--
-- Everything Postgres did in RLS/triggers/RPCs moves to server functions:
--   RLS policies          -> authorization checks in src/server/db/* helpers
--   check_match_on_crush  -> transactional mutual-match detect in addCrush fn
--   enforce_crush_slot_limit, enforce_min_age, normalize handles,
--   notify_* triggers, trust score refresh, referral awards,
--   set_match_expiry, touch_*_on_message -> same server fns, same semantics
--   generate_daily_polls / expiry warner / weekly superlative -> CF Cron Triggers
--   send idempotency (client_id partial unique) -> kept as real UNIQUE indexes

PRAGMA defer_foreign_keys = false;

-- ============ AUTH (replaces Supabase GoTrue) ============

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,            -- PBKDF2-SHA256, format: iterations$salt$hash (base64)
  email_verified_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,           -- SHA-256 of the opaque bearer token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

-- ============ PROFILES ============

CREATE TABLE IF NOT EXISTS profiles (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  handle                 TEXT NOT NULL UNIQUE,      -- normalized: lower, no '@'
  emoji                  TEXT NOT NULL DEFAULT '✨',
  avatar_url             TEXT,
  dob                    TEXT,                      -- ISO date; >=13 enforced in server fn
  school                 TEXT,
  city                   TEXT,
  phone_e164             TEXT,
  instagram_handle       TEXT UNIQUE,               -- normalized: lower, no '@'
  instagram_name         TEXT,
  instagram_avatar       TEXT,
  instagram_followers    INTEGER,
  instagram_verified_at  TEXT,
  instagram_verify_code  TEXT,
  handle_confirmed_at    TEXT,
  referral_code          TEXT UNIQUE,               -- generated at profile creation
  referred_by            TEXT,                      -- users.id of referrer
  crush_slots            INTEGER NOT NULL DEFAULT 3,  -- cap 8 via referral awards
  hint_credits           INTEGER NOT NULL DEFAULT 0,
  god_mode_expires_at    TEXT,
  trust_score            INTEGER NOT NULL DEFAULT 0,  -- 0-100, refreshed server-side
  push_enabled           INTEGER NOT NULL DEFAULT 0,
  suspended_at           TEXT,                        -- moderation hold
  streak_count           INTEGER NOT NULL DEFAULT 0,
  streak_last_open       TEXT,                        -- ISO date
  onboarded_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS profiles_school_idx ON profiles(school);
CREATE INDEX IF NOT EXISTS profiles_phone_idx ON profiles(phone_e164);

-- ============ CRUSHES ============

CREATE TABLE IF NOT EXISTS crushes (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_handle TEXT NOT NULL,            -- normalized; may belong to a non-user (escrow)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (owner_id, target_handle)
);
CREATE INDEX IF NOT EXISTS crushes_target_idx ON crushes(target_handle);

-- ============ MATCHES / MESSAGES ============

CREATE TABLE IF NOT EXISTS matches (
  id               TEXT PRIMARY KEY,
  user_a_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at       TEXT,                  -- created_at + 7d, set server-side
  expiry_warned_at TEXT,
  last_message_at  TEXT,
  saved            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS matches_a_idx ON matches(user_a_id);
CREATE INDEX IF NOT EXISTS matches_b_idx ON matches(user_b_id);
CREATE INDEX IF NOT EXISTS matches_expiry_idx ON matches(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  match_id     TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  client_id    TEXT,                      -- send idempotency
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS messages_match_idx ON messages(match_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_id_unique
  ON messages(match_id, from_user_id, client_id) WHERE client_id IS NOT NULL;

-- ============ GROUPS ============

CREATE TABLE IF NOT EXISTS group_chats (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  emoji           TEXT NOT NULL DEFAULT '💬',
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  TEXT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id);

CREATE TABLE IF NOT EXISTS group_messages (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  client_id    TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS group_messages_group_idx ON group_messages(group_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS group_messages_client_id_unique
  ON group_messages(group_id, from_user_id, client_id) WHERE client_id IS NOT NULL;

-- ============ READ CURSORS ============

CREATE TABLE IF NOT EXISTS conversation_reads (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('match','group')),
  conv_id      TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, conv_id)
);

-- ============ POLLS ============

CREATE TABLE IF NOT EXISTS poll_questions (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'fun',
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS polls (
  id             TEXT PRIMARY KEY,
  question       TEXT NOT NULL,
  option_handles TEXT NOT NULL,           -- JSON array of normalized handles (may include non-users)
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,  -- NULL = daily auto-poll
  school         TEXT,
  question_id    TEXT REFERENCES poll_questions(id) ON DELETE SET NULL,
  active_date    TEXT,                    -- ISO date for daily polls
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- one daily auto-poll per (school, day); user polls have active_date NULL
CREATE UNIQUE INDEX IF NOT EXISTS uniq_polls_daily
  ON polls(active_date, coalesce(school,'')) WHERE active_date IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_polls_school_question_day
  ON polls(school, question_id, date(created_at)) WHERE question_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS poll_votes (
  id           TEXT PRIMARY KEY,
  poll_id      TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voted_handle TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (poll_id, user_id)
);
CREATE INDEX IF NOT EXISTS poll_votes_handle_idx ON poll_votes(voted_handle, created_at);

CREATE TABLE IF NOT EXISTS pending_questions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS poll_share_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ NOTIFICATIONS ============

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,               -- match_created | message_received | group_message_received
                                          -- | poll_voted_for | referral_joined | crush_received
  payload    TEXT NOT NULL DEFAULT '{}',  -- JSON; IDs/counts only, never message text
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);

-- ============ REFERRALS / INVITES ============

CREATE TABLE IF NOT EXISTS referrals (
  id               TEXT PRIMARY KEY,
  referrer_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_id);

CREATE TABLE IF NOT EXISTS invites (
  id            TEXT PRIMARY KEY,
  sender_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_hash    TEXT,
  target_handle TEXT,
  channel       TEXT NOT NULL DEFAULT 'sms',  -- sms | share | copy
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS invites_sender_idx ON invites(sender_id, created_at DESC);

-- ============ HINTS ============

CREATE TABLE IF NOT EXISTS hints (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_handle TEXT NOT NULL,
  hint_index    INTEGER NOT NULL,
  hint_text     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, target_handle, hint_index)
);

-- ============ QUIZ ============

CREATE TABLE IF NOT EXISTS quiz_answers (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  vibe       TEXT,
  sleep      TEXT,
  texting    TEXT,
  weekend    TEXT,
  flag       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ SUPERLATIVES / REPORTS / PURCHASES ============

CREATE TABLE IF NOT EXISTS weekly_superlatives (
  id            TEXT PRIMARY KEY,
  school        TEXT,
  week_start    TEXT NOT NULL,            -- ISO date
  question_id   TEXT,
  question      TEXT NOT NULL,
  winner_handle TEXT NOT NULL,
  votes         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (school, week_start, question_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id               TEXT PRIMARY KEY,
  reporter_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id TEXT NOT NULL,
  reason           TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (reporter_id <> reported_user_id)
);
CREATE INDEX IF NOT EXISTS reports_reported_idx ON reports(reported_user_id);

CREATE TABLE IF NOT EXISTS purchases (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product      TEXT NOT NULL,             -- hint_pack_5 | weekend_boost_one | match_save_one | god_mode_weekly
  amount_cents INTEGER NOT NULL DEFAULT 0,
  metadata     TEXT NOT NULL DEFAULT '{}',  -- JSON; idempotency key = $.sessionId
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS purchases_session_unique
  ON purchases(user_id, json_extract(metadata,'$.sessionId'))
  WHERE json_extract(metadata,'$.sessionId') IS NOT NULL;

-- ============ PUSH ============
-- Web Push subscriptions (VAPID). Native FCM/APNs tokens land here too, with
-- kind='fcm'|'apns' and the token in `endpoint`.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'webpush',   -- webpush | fcm | apns
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT,
  auth       TEXT,
  failures   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON push_subscriptions(user_id);

-- ============ CONTACT GRAPH ============
-- One row per (owner, contact) edge. Phone numbers are NEVER stored in the
-- clear: phone_hash is an HMAC for matching, phone_enc is AES-GCM for delivery.
CREATE TABLE IF NOT EXISTS contact_edges (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_hash    TEXT NOT NULL,
  phone_enc     TEXT,
  name_as_saved TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (owner_id, phone_hash)
);
CREATE INDEX IF NOT EXISTS contact_edges_phone_idx ON contact_edges(phone_hash);

-- One node per real-world person, identified by their phone hash. Attributes
-- are inferred from the crowd (how many address books hold them, what school
-- their holders attend).
CREATE TABLE IF NOT EXISTS person_nodes (
  phone_hash     TEXT PRIMARY KEY,
  canonical_name TEXT,
  school_guess   TEXT,
  degree         INTEGER NOT NULL DEFAULT 0,   -- centrality: # of address books
  user_id        TEXT,                          -- set once they join
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS person_nodes_degree_idx ON person_nodes(degree DESC);
CREATE INDEX IF NOT EXISTS person_nodes_school_idx ON person_nodes(school_guess);

-- handle <-> phone links, however they were established.
CREATE TABLE IF NOT EXISTS handle_phone_links (
  id         TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  handle     TEXT NOT NULL,
  source     TEXT NOT NULL,        -- signup | sender_confirmed | name_match
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (phone_hash, handle)
);
CREATE INDEX IF NOT EXISTS handle_phone_handle_idx ON handle_phone_links(handle);

-- ============ OUTREACH ============
-- Anonymous "someone picked you" notices. One per target until they respond,
-- plus at most one reminder — enforced in the server fn, recorded here.
CREATE TABLE IF NOT EXISTS outreach_sends (
  id            TEXT PRIMARY KEY,
  sender_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  phone_hash    TEXT NOT NULL,
  target_handle TEXT,
  kind          TEXT NOT NULL DEFAULT 'crush_notice',
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | failed | suppressed
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS outreach_phone_idx ON outreach_sends(phone_hash, created_at DESC);

-- Global opt-out. Honored forever, checked before every send.
CREATE TABLE IF NOT EXISTS outreach_optouts (
  phone_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ MODERATION ============
-- Reports already exist; this records what a reviewer decided.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id          TEXT PRIMARY KEY,
  report_id   TEXT,
  target_user TEXT,
  action      TEXT NOT NULL,       -- reviewed | warned | suspended | dismissed
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Suspension flag consulted by the auth middleware.

-- ============ REALTIME (Phase B websockets) ============
-- Short-lived tickets that authorize a WebSocket connect to the realtime
-- Worker's Durable Object for one room. Issued by the app after an ownership
-- check; validated + consumed by the realtime Worker (both bind CRUSH_DB, so
-- no shared secret is needed). Rooms: "match:<matchId>", "group:<groupId>",
-- "notif:<userId>".
CREATE TABLE IF NOT EXISTS realtime_tickets (
  ticket     TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  room       TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS realtime_tickets_exp_idx ON realtime_tickets(expires_at);
