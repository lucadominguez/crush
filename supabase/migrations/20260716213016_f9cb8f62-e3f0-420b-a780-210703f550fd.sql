
-- Helper: earned slot target for a referral count (cap 8, +1 per 3 referrals over base 3)
CREATE OR REPLACE FUNCTION public.referral_slot_target(_count integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT LEAST(8, 3 + GREATEST(0, COALESCE(_count, 0)) / 3);
$$;

-- Atomic claim: validate code, link, record referral row, bump slots without decreasing.
CREATE OR REPLACE FUNCTION public.claim_referral(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_referrer uuid;
  v_existing_referrer uuid;
  v_count integer;
  v_target integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_code := upper(trim(COALESCE(_code, '')));
  IF length(v_code) < 4 OR length(v_code) > 12 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;

  -- Lock the current user's profile row to serialize concurrent claims
  SELECT referred_by INTO v_existing_referrer
  FROM public.profiles
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  SELECT user_id INTO v_referrer
  FROM public.profiles
  WHERE referral_code = v_code
  LIMIT 1;

  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  IF v_referrer = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_referral');
  END IF;

  IF v_existing_referrer IS NOT NULL AND v_existing_referrer <> v_referrer THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_referred');
  END IF;

  IF v_existing_referrer IS NULL THEN
    UPDATE public.profiles
       SET referred_by = v_referrer
     WHERE user_id = v_uid AND referred_by IS NULL;
  END IF;

  -- Ensure exactly one referrals row; unique(referred_user_id) enforces this
  INSERT INTO public.referrals (referrer_id, referred_user_id)
  VALUES (v_referrer, v_uid)
  ON CONFLICT (referred_user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_count FROM public.referrals WHERE referrer_id = v_referrer;
  v_target := public.referral_slot_target(v_count);

  -- Never decrease an existing higher allowance (paid, boosted, admin-granted)
  UPDATE public.profiles
     SET crush_slots = GREATEST(COALESCE(crush_slots, 3), v_target)
   WHERE user_id = v_referrer;

  RETURN jsonb_build_object(
    'ok', true,
    'already', (v_existing_referrer IS NOT NULL),
    'referrer_total', v_count,
    'earned_slots', LEAST(5, GREATEST(0, v_target - 3))
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $$;

-- Idempotent repair: if referred_by is set but no referrals row exists, create one and credit.
CREATE OR REPLACE FUNCTION public.repair_missing_referral()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_referrer uuid;
  v_count integer;
  v_target integer;
  v_had_row boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT referred_by INTO v_referrer
  FROM public.profiles
  WHERE user_id = v_uid
  FOR UPDATE;

  IF v_referrer IS NULL OR v_referrer = v_uid THEN
    RETURN jsonb_build_object('ok', true, 'repaired', false);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.referrals WHERE referred_user_id = v_uid) INTO v_had_row;
  IF v_had_row THEN
    RETURN jsonb_build_object('ok', true, 'repaired', false);
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_user_id)
  VALUES (v_referrer, v_uid)
  ON CONFLICT (referred_user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_count FROM public.referrals WHERE referrer_id = v_referrer;
  v_target := public.referral_slot_target(v_count);
  UPDATE public.profiles
     SET crush_slots = GREATEST(COALESCE(crush_slots, 3), v_target)
   WHERE user_id = v_referrer;

  RETURN jsonb_build_object('ok', true, 'repaired', true, 'referrer_total', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $$;

GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_missing_referral() TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_slot_target(integer) TO authenticated;
