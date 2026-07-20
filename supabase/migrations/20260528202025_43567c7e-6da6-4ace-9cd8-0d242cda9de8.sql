ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dob date,
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT false;

-- Enforce age >= 13 at the database (COPPA backstop). NULL allowed for legacy rows.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_dob_min_age;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_dob_min_age
  CHECK (dob IS NULL OR dob <= (CURRENT_DATE - INTERVAL '13 years'));