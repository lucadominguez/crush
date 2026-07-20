
-- ============================================================
-- Profiles: Instagram claim + trust score
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS instagram_name text,
  ADD COLUMN IF NOT EXISTS instagram_avatar text,
  ADD COLUMN IF NOT EXISTS instagram_followers integer,
  ADD COLUMN IF NOT EXISTS instagram_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS instagram_verify_code text,
  ADD COLUMN IF NOT EXISTS trust_score integer NOT NULL DEFAULT 0;

-- Normalize handle on write
CREATE OR REPLACE FUNCTION public.normalize_instagram_handle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.instagram_handle IS NOT NULL THEN
    NEW.instagram_handle := lower(regexp_replace(NEW.instagram_handle, '^@', ''));
    IF NEW.instagram_handle = '' THEN NEW.instagram_handle := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_normalize_ig ON public.profiles;
CREATE TRIGGER trg_profiles_normalize_ig
  BEFORE INSERT OR UPDATE OF instagram_handle ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_instagram_handle();

-- Unique IG handle (case already normalized)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_instagram_handle_key
  ON public.profiles (instagram_handle)
  WHERE instagram_handle IS NOT NULL;

-- ============================================================
-- Reports table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  reported_user_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_user_id)
);

CREATE INDEX IF NOT EXISTS reports_reported_user_idx ON public.reports(reported_user_id);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reporter views own reports" ON public.reports;
CREATE POLICY "Reporter views own reports"
  ON public.reports FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Reporter creates own report" ON public.reports;
CREATE POLICY "Reporter creates own report"
  ON public.reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- ============================================================
-- Trust score calculation
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_trust_score(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score integer := 0;
  v_profile record;
  v_age_days integer;
  v_matches integer;
  v_incoming_crushes integer;
  v_reports integer;
  v_my_handle text;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE user_id = _user_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- IG claimed
  IF v_profile.instagram_handle IS NOT NULL THEN
    v_score := v_score + 10;
  END IF;

  -- IG verified
  IF v_profile.instagram_verified_at IS NOT NULL THEN
    v_score := v_score + 30;
  END IF;

  -- Account age (1pt/day, cap 30)
  v_age_days := LEAST(30, GREATEST(0, EXTRACT(DAY FROM (now() - v_profile.created_at))::int));
  v_score := v_score + v_age_days;

  -- Matches (5 each, cap 25)
  SELECT COUNT(*) INTO v_matches FROM public.matches
   WHERE user_a_id = _user_id OR user_b_id = _user_id;
  v_score := v_score + LEAST(25, v_matches * 5);

  -- Incoming crushes (people who picked this user) — 2 each, cap 20
  v_my_handle := v_profile.handle;
  IF v_my_handle IS NOT NULL THEN
    SELECT COUNT(*) INTO v_incoming_crushes FROM public.crushes
     WHERE target_handle = v_my_handle AND owner_id <> _user_id;
    v_score := v_score + LEAST(20, v_incoming_crushes * 2);
  END IF;

  -- Reports against (-15 each)
  SELECT COUNT(*) INTO v_reports FROM public.reports WHERE reported_user_id = _user_id;
  v_score := v_score - (v_reports * 15);

  RETURN GREATEST(0, LEAST(100, v_score));
END $$;

CREATE OR REPLACE FUNCTION public.refresh_trust_score(_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
     SET trust_score = public.calculate_trust_score(_user_id)
   WHERE user_id = _user_id;
$$;

-- Recompute on match create (both users)
CREATE OR REPLACE FUNCTION public.trg_refresh_trust_on_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_trust_score(NEW.user_a_id);
  PERFORM public.refresh_trust_score(NEW.user_b_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_matches_trust ON public.matches;
CREATE TRIGGER trg_matches_trust AFTER INSERT ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_trust_on_match();

-- Recompute on crush insert (the target may gain incoming-crush points)
CREATE OR REPLACE FUNCTION public.trg_refresh_trust_on_crush()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_target_user uuid;
BEGIN
  SELECT user_id INTO v_target_user FROM public.profiles WHERE handle = NEW.target_handle;
  IF v_target_user IS NOT NULL THEN
    PERFORM public.refresh_trust_score(v_target_user);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_crushes_trust ON public.crushes;
CREATE TRIGGER trg_crushes_trust AFTER INSERT ON public.crushes
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_trust_on_crush();

-- Recompute on report
CREATE OR REPLACE FUNCTION public.trg_refresh_trust_on_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_trust_score(NEW.reported_user_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reports_trust ON public.reports;
CREATE TRIGGER trg_reports_trust AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_trust_on_report();

-- Recompute on profile IG changes
CREATE OR REPLACE FUNCTION public.trg_refresh_trust_on_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.trust_score := public.calculate_trust_score(NEW.user_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_profiles_trust ON public.profiles;
CREATE TRIGGER trg_profiles_trust
  BEFORE UPDATE OF instagram_handle, instagram_verified_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_trust_on_profile();

-- Backfill existing rows
UPDATE public.profiles SET trust_score = public.calculate_trust_score(user_id);
