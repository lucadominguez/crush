
-- 1. Extend profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS crush_slots integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS god_mode_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS streak_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_last_open date,
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid,
  ADD COLUMN IF NOT EXISTS phone_e164 text;

CREATE INDEX IF NOT EXISTS idx_profiles_phone_e164 ON public.profiles(phone_e164);
CREATE INDEX IF NOT EXISTS idx_profiles_school ON public.profiles(school);

-- 2. Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, read_at) WHERE read_at IS NULL;

-- 3. Quiz answers
CREATE TABLE IF NOT EXISTS public.quiz_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  vibe text,
  sleep text,
  texting text,
  weekend text,
  flag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quiz_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Quiz answers viewable by authenticated" ON public.quiz_answers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own quiz" ON public.quiz_answers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own quiz" ON public.quiz_answers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_quiz_answers_updated_at
  BEFORE UPDATE ON public.quiz_answers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4. "Someone added you" notification trigger
CREATE OR REPLACE FUNCTION public.notify_target_on_crush()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id uuid;
BEGIN
  SELECT user_id INTO v_target_user_id
  FROM public.profiles
  WHERE handle = lower(regexp_replace(NEW.target_handle, '^@', ''));

  IF v_target_user_id IS NOT NULL AND v_target_user_id <> NEW.owner_id THEN
    INSERT INTO public.notifications (user_id, type, payload)
    VALUES (v_target_user_id, 'crush_received', jsonb_build_object('at', now()));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_target_on_crush ON public.crushes;
CREATE TRIGGER trg_notify_target_on_crush
  AFTER INSERT ON public.crushes
  FOR EACH ROW EXECUTE FUNCTION public.notify_target_on_crush();

-- 5. Crush slot limit enforcement
CREATE OR REPLACE FUNCTION public.enforce_crush_slot_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_slots integer;
  v_count integer;
BEGIN
  SELECT crush_slots INTO v_slots FROM public.profiles WHERE user_id = NEW.owner_id;
  SELECT COUNT(*) INTO v_count FROM public.crushes WHERE owner_id = NEW.owner_id;
  IF v_count >= COALESCE(v_slots, 3) THEN
    RAISE EXCEPTION 'crush_slot_limit_reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_crush_slot_limit ON public.crushes;
CREATE TRIGGER trg_enforce_crush_slot_limit
  BEFORE INSERT ON public.crushes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crush_slot_limit();

-- 6. Referral code generator
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  IF NEW.referral_code IS NULL THEN
    LOOP
      v_code := upper(substr(md5(random()::text || NEW.user_id::text), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_code);
    END LOOP;
    NEW.referral_code := v_code;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_generate_referral_code ON public.profiles;
CREATE TRIGGER trg_generate_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_referral_code();

-- Backfill existing profiles
UPDATE public.profiles
SET referral_code = upper(substr(md5(random()::text || user_id::text), 1, 6))
WHERE referral_code IS NULL;

-- 7. Realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
