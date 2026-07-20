
-- invites: track outgoing share/sms intents for rate limit + referral credit
CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  phone_hash text,
  target_handle text,
  channel text NOT NULL DEFAULT 'sms', -- 'sms' | 'share' | 'copy'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invites_sender_created ON public.invites(sender_id, created_at DESC);
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sender views own invites" ON public.invites FOR SELECT TO authenticated USING (auth.uid() = sender_id);
CREATE POLICY "Sender inserts own invites" ON public.invites FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);

-- referrals: credited when a new profile sets referred_by
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  referred_user_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_referrals_referrer ON public.referrals(referrer_id);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Referrer views own referrals" ON public.referrals FOR SELECT TO authenticated USING (auth.uid() = referrer_id);

-- hints: progressive context-only nudges (no identity)
CREATE TABLE public.hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  target_handle text NOT NULL,
  hint_index int NOT NULL,
  hint_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_handle, hint_index)
);
CREATE INDEX idx_hints_user ON public.hints(user_id, created_at DESC);
ALTER TABLE public.hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User views own hints" ON public.hints FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "User inserts own hints" ON public.hints FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- weekly superlatives: one row per (school, week_start, question_id)
CREATE TABLE public.weekly_superlatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school text,
  week_start date NOT NULL,
  question_id uuid,
  question text NOT NULL,
  winner_handle text NOT NULL,
  votes int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school, week_start, question_id)
);
ALTER TABLE public.weekly_superlatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Superlatives readable by authenticated" ON public.weekly_superlatives FOR SELECT TO authenticated USING (true);

-- trigger: when profile created with referred_by, log referral + bump slots
CREATE OR REPLACE FUNCTION public.handle_referral_on_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NEW.referred_by IS NULL OR NEW.referred_by = NEW.user_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.referrals (referrer_id, referred_user_id)
  VALUES (NEW.referred_by, NEW.user_id)
  ON CONFLICT (referred_user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_count FROM public.referrals WHERE referrer_id = NEW.referred_by;
  -- +1 slot per 3 referrals, cap at 8
  UPDATE public.profiles
     SET crush_slots = LEAST(8, 3 + (v_count / 3))
   WHERE user_id = NEW.referred_by;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_handle_referral_on_profile ON public.profiles;
CREATE TRIGGER trg_handle_referral_on_profile
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_referral_on_profile();

-- pg_cron: weekly superlative every Sunday 17:00 UTC
SELECT cron.schedule(
  'weekly-superlative',
  '0 17 * * 0',
  $cron$
  SELECT net.http_post(
    url := 'https://project--a0b29d2b-b63e-48bc-8250-6331b651ad2b.lovable.app/api/public/hooks/weekly-superlative',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);
