-- Narrow update: cast_poll_vote returns the caller's own actual vote on both
-- success and already-voted (unique conflict), so the client can reconcile
-- without inferring from the tapped handle. No policy, cron, or grant changes.
CREATE OR REPLACE FUNCTION public.cast_poll_vote(_poll_id uuid, _handle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_h text;
  v_poll record;
  v_me record;
  v_visible boolean;
  v_own text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_h := lower(regexp_replace(coalesce(_handle,''), '^@', ''));
  IF v_h = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_option');
  END IF;

  SELECT id, option_handles, school, created_by
    INTO v_poll
  FROM public.polls WHERE id = _poll_id;

  IF v_poll.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'poll_not_found');
  END IF;

  SELECT lower(coalesce(nullif(trim(school),''), '')) AS school_key,
         handle, instagram_handle
    INTO v_me
  FROM public.profiles WHERE user_id = v_uid;

  v_visible :=
    v_poll.created_by = v_uid
    OR (v_me.handle IS NOT NULL AND v_me.handle = ANY(v_poll.option_handles))
    OR (v_me.instagram_handle IS NOT NULL AND v_me.instagram_handle = ANY(v_poll.option_handles))
    OR lower(coalesce(nullif(trim(v_poll.school),''), '')) = coalesce(v_me.school_key, '');

  IF NOT v_visible THEN
    RETURN jsonb_build_object('ok', false, 'error', 'poll_not_found');
  END IF;

  IF NOT (v_h = ANY(v_poll.option_handles)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_option');
  END IF;

  BEGIN
    INSERT INTO public.poll_votes (poll_id, user_id, voted_handle)
    VALUES (_poll_id, v_uid, v_h);
  EXCEPTION WHEN unique_violation THEN
    SELECT voted_handle INTO v_own
    FROM public.poll_votes
    WHERE poll_id = _poll_id AND user_id = v_uid;
    RETURN jsonb_build_object('ok', false, 'error', 'already_voted', 'already', true, 'own_vote', v_own);
  END;
  RETURN jsonb_build_object('ok', true, 'own_vote', v_h);
END $function$;
