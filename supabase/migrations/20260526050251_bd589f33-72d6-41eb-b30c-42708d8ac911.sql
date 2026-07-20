
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

-- Set default 7-day expiry on newly created matches
CREATE OR REPLACE FUNCTION public.set_match_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + interval '7 days';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_match_expiry ON public.matches;
CREATE TRIGGER trg_set_match_expiry
  BEFORE INSERT ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_match_expiry();

-- Clear expiry + bump last_message_at when a message lands
CREATE OR REPLACE FUNCTION public.touch_match_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.matches
     SET last_message_at = now(),
         expires_at = NULL
   WHERE id = NEW.match_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_match_on_message ON public.messages;
CREATE TRIGGER trg_touch_match_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_match_on_message();

-- Backfill: existing matches with messages get cleared expiry,
-- existing matches without messages get a 7-day window from now.
UPDATE public.matches m
   SET last_message_at = sub.last_at,
       expires_at = NULL
  FROM (
    SELECT match_id, max(created_at) AS last_at
      FROM public.messages
     GROUP BY match_id
  ) sub
 WHERE m.id = sub.match_id;

UPDATE public.matches
   SET expires_at = now() + interval '7 days'
 WHERE expires_at IS NULL
   AND last_message_at IS NULL;
