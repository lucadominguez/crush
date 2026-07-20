-- Phase B schema: push delivery, contact graph, outreach, moderation.
-- Idempotent-ish: run once. Mirrored into db/schema.sql for fresh installs.

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
ALTER TABLE profiles ADD COLUMN suspended_at TEXT;
