ALTER TABLE profiles ADD COLUMN streak_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN streak_last_open TEXT;
ALTER TABLE profiles ADD COLUMN onboarded_at TEXT;
