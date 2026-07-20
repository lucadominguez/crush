
-- Onboarding completion + handle-confirmation gates
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS handle_confirmed_at timestamptz;

-- Enforce 13+ whenever dob is set/changed (allow NULL for legacy/OAuth freshly-created rows).
CREATE OR REPLACE FUNCTION public.enforce_min_age()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.dob IS NOT NULL THEN
    IF NEW.dob > (current_date - interval '13 years')::date THEN
      RAISE EXCEPTION 'min_age_13' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_min_age ON public.profiles;
CREATE TRIGGER trg_enforce_min_age
  BEFORE INSERT OR UPDATE OF dob ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_min_age();

-- Atomic handle claim: validates format, prevents reserved names, checks uniqueness,
-- and marks handle_confirmed_at. Runs as the authenticated user (RLS applies via caller).
CREATE OR REPLACE FUNCTION public.claim_handle(_new_handle text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text;
  v_current text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_norm := lower(regexp_replace(coalesce(_new_handle,''), '^@', ''));
  v_norm := trim(v_norm);

  IF v_norm = '' OR v_norm IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'handle_required');
  END IF;
  IF length(v_norm) < 3 OR length(v_norm) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'handle_length');
  END IF;
  IF v_norm !~ '^[a-z0-9][a-z0-9_.]*[a-z0-9]$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'handle_chars');
  END IF;
  IF v_norm ~ '\.\.' OR v_norm ~ '__' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'handle_chars');
  END IF;
  IF v_norm IN ('admin','root','support','help','api','app','crush','official','staff','mod','moderator','system','about','privacy','terms','login','signup','onboarding','auth','settings','me','you') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'handle_reserved');
  END IF;

  SELECT handle INTO v_current FROM public.profiles WHERE user_id = v_uid;
  IF v_current = v_norm THEN
    UPDATE public.profiles
       SET handle_confirmed_at = COALESCE(handle_confirmed_at, now())
     WHERE user_id = v_uid;
    RETURN jsonb_build_object('ok', true, 'handle', v_norm);
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE handle = v_norm AND user_id <> v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'handle_taken');
  END IF;

  BEGIN
    UPDATE public.profiles
       SET handle = v_norm,
           handle_confirmed_at = now()
     WHERE user_id = v_uid;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'handle_taken');
  END;

  RETURN jsonb_build_object('ok', true, 'handle', v_norm);
END $$;

GRANT EXECUTE ON FUNCTION public.claim_handle(text) TO authenticated;
