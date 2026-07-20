-- matches: saved flag + warned timestamp
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS saved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expiry_warned_at timestamptz;

-- profiles: hint credits balance
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hint_credits integer NOT NULL DEFAULT 0;

-- polls: one-per-day server-generated
ALTER TABLE public.polls
  ADD COLUMN IF NOT EXISTS active_date date;
CREATE UNIQUE INDEX IF NOT EXISTS polls_active_date_school_unique
  ON public.polls(active_date, COALESCE(school, ''))
  WHERE active_date IS NOT NULL;

-- purchases
CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own purchases"
  ON public.purchases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow user to insert their own (stubbed payments; we'll tighten when Stripe webhooks land)
CREATE POLICY "Users create own purchases"
  ON public.purchases FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS purchases_user_idx ON public.purchases(user_id, created_at DESC);