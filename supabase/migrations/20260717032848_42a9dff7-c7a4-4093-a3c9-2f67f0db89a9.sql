
-- Atomic purchase-record + entitlement-grant. Service role only.
CREATE OR REPLACE FUNCTION public.record_purchase_and_grant(
  _user_id uuid,
  _product text,
  _amount_cents integer,
  _session_id text,
  _match_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  IF _user_id IS NULL OR _product IS NULL OR _session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  -- Idempotency: (user_id, sessionId) already recorded?
  SELECT id INTO v_existing
  FROM public.purchases
  WHERE user_id = _user_id
    AND metadata->>'sessionId' = _session_id
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  INSERT INTO public.purchases (user_id, product, amount_cents, metadata)
  VALUES (
    _user_id,
    _product,
    COALESCE(_amount_cents, 0),
    jsonb_strip_nulls(jsonb_build_object('sessionId', _session_id, 'matchId', _match_id))
  );

  -- One-time entitlement grants (subscription products handled by subscription events, not here).
  IF _product = 'hint_pack_5' THEN
    UPDATE public.profiles
       SET hint_credits = COALESCE(hint_credits, 0) + 5
     WHERE user_id = _user_id;
  ELSIF _product = 'weekend_boost_one' THEN
    UPDATE public.profiles
       SET crush_slots = LEAST(12, COALESCE(crush_slots, 3) + 3)
     WHERE user_id = _user_id;
  ELSIF _product = 'match_save_one' AND _match_id IS NOT NULL THEN
    UPDATE public.matches
       SET saved = true, expires_at = NULL
     WHERE id = _match_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false);
END $$;

-- Lock down execution to service role only.
REVOKE ALL ON FUNCTION public.record_purchase_and_grant(uuid, text, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_purchase_and_grant(uuid, text, integer, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_purchase_and_grant(uuid, text, integer, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_purchase_and_grant(uuid, text, integer, text, uuid) TO service_role;
