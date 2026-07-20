
CREATE OR REPLACE FUNCTION public.check_match_on_crush()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_user_id UUID;
  v_my_handle TEXT;
  v_my_ig TEXT;
BEGIN
  NEW.target_handle := lower(regexp_replace(NEW.target_handle, '^@', ''));

  -- Resolve target user by handle OR instagram_handle
  SELECT user_id INTO v_target_user_id
  FROM public.profiles
  WHERE handle = NEW.target_handle OR instagram_handle = NEW.target_handle
  LIMIT 1;

  IF v_target_user_id IS NULL OR v_target_user_id = NEW.owner_id THEN
    RETURN NEW;
  END IF;

  SELECT handle, instagram_handle INTO v_my_handle, v_my_ig
  FROM public.profiles WHERE user_id = NEW.owner_id;

  IF EXISTS (
    SELECT 1 FROM public.crushes
    WHERE owner_id = v_target_user_id
      AND target_handle IN (
        COALESCE(v_my_handle, ''),
        COALESCE(v_my_ig, '')
      )
      AND target_handle <> ''
  ) AND NOT EXISTS (
    SELECT 1 FROM public.matches
    WHERE (user_a_id = NEW.owner_id AND user_b_id = v_target_user_id)
       OR (user_a_id = v_target_user_id AND user_b_id = NEW.owner_id)
  ) THEN
    INSERT INTO public.matches (user_a_id, user_b_id) VALUES (NEW.owner_id, v_target_user_id);
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.notify_target_on_crush()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_user_id uuid;
BEGIN
  SELECT user_id INTO v_target_user_id
  FROM public.profiles
  WHERE handle = lower(regexp_replace(NEW.target_handle, '^@', ''))
     OR instagram_handle = lower(regexp_replace(NEW.target_handle, '^@', ''))
  LIMIT 1;

  IF v_target_user_id IS NOT NULL AND v_target_user_id <> NEW.owner_id THEN
    INSERT INTO public.notifications (user_id, type, payload)
    VALUES (v_target_user_id, 'crush_received', jsonb_build_object('at', now()));
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_refresh_trust_on_crush()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_target_user uuid;
BEGIN
  SELECT user_id INTO v_target_user
  FROM public.profiles
  WHERE handle = NEW.target_handle OR instagram_handle = NEW.target_handle
  LIMIT 1;
  IF v_target_user IS NOT NULL THEN
    PERFORM public.refresh_trust_score(v_target_user);
  END IF;
  RETURN NEW;
END $function$;

-- Backfill missed mutual matches
INSERT INTO public.matches (user_a_id, user_b_id)
SELECT DISTINCT LEAST(c1.owner_id, p2.user_id), GREATEST(c1.owner_id, p2.user_id)
FROM public.crushes c1
JOIN public.profiles p2
  ON p2.handle = c1.target_handle OR p2.instagram_handle = c1.target_handle
JOIN public.profiles p1
  ON p1.user_id = c1.owner_id
JOIN public.crushes c2
  ON c2.owner_id = p2.user_id
 AND (c2.target_handle = p1.handle OR c2.target_handle = p1.instagram_handle)
WHERE c1.owner_id <> p2.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE (m.user_a_id = c1.owner_id AND m.user_b_id = p2.user_id)
       OR (m.user_a_id = p2.user_id AND m.user_b_id = c1.owner_id)
  );
