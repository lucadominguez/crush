
ALTER TABLE public.polls
  ADD COLUMN IF NOT EXISTS school TEXT,
  ADD COLUMN IF NOT EXISTS question_id UUID;

CREATE TABLE IF NOT EXISTS public.poll_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fun',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.poll_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Poll questions readable by authenticated" ON public.poll_questions;
CREATE POLICY "Poll questions readable by authenticated"
  ON public.poll_questions FOR SELECT
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.pending_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pending_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own pending question" ON public.pending_questions;
CREATE POLICY "Users insert own pending question"
  ON public.pending_questions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own pending questions" ON public.pending_questions;
CREATE POLICY "Users view own pending questions"
  ON public.pending_questions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.poll_share_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  poll_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.poll_share_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own share event" ON public.poll_share_events;
CREATE POLICY "Users insert own share event"
  ON public.poll_share_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own share events" ON public.poll_share_events;
CREATE POLICY "Users view own share events"
  ON public.poll_share_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- One auto-poll per (school, question, day). created_at::date is IMMUTABLE.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_polls_daily
  ON public.polls (school, question_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE question_id IS NOT NULL;

INSERT INTO public.poll_questions (text, category) VALUES
  ('Most likely to start a cult', 'fun'),
  ('Most likely to text back at 3am', 'fun'),
  ('Has the best music taste', 'taste'),
  ('Would survive longest in a zombie apocalypse', 'fun'),
  ('Most likely to glow up in college', 'fun'),
  ('Would make the best road trip co-pilot', 'fun'),
  ('Has the most underrated style', 'taste'),
  ('Most likely to become famous on TikTok', 'fun'),
  ('Best person to share secrets with', 'wholesome'),
  ('Most likely to spontaneously book a flight', 'fun'),
  ('Looks like they tell the funniest stories', 'fun'),
  ('Most likely to ace a vibe check', 'fun'),
  ('Best aesthetic on their feed', 'taste'),
  ('Most likely to fall in love this year', 'wholesome'),
  ('Could probably beat me in a dance battle', 'fun'),
  ('Most likely to start a podcast nobody asked for', 'fun'),
  ('Would write you back the loveliest birthday message', 'wholesome'),
  ('Has main character energy', 'fun'),
  ('Most likely to disappear and become a chef in Italy', 'fun'),
  ('Person you''d want on your trivia team', 'fun')
ON CONFLICT DO NOTHING;
