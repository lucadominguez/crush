
-- =========================================================================
-- 1. Remove direct client INSERT paths on polls and poll_votes.
--    Writes must go through SECURITY DEFINER RPCs (create_poll, cast_poll_vote)
--    so rate-limits, cohort/option validation, and anonymity guarantees hold.
-- =========================================================================
DROP POLICY IF EXISTS "Users create their own polls" ON public.polls;
DROP POLICY IF EXISTS "Users cast their own vote" ON public.poll_votes;

-- =========================================================================
-- 2. Fix polls SELECT: null-school polls are cohort-scoped (only null cohort),
--    not global. Creator and option targets still see regardless of cohort.
-- =========================================================================
DROP POLICY IF EXISTS "Polls viewable in cohort" ON public.polls;
CREATE POLICY "Polls viewable in cohort" ON public.polls
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.user_id = auth.uid()
        AND (
          -- Option-target visibility (creator and target-of-poll always see)
          me.handle = ANY(polls.option_handles)
          OR (me.instagram_handle IS NOT NULL AND me.instagram_handle = ANY(polls.option_handles))
          -- Cohort visibility, with null/blank school treated as its own cohort
          OR lower(coalesce(nullif(trim(polls.school),''), '')) =
             lower(coalesce(nullif(trim(me.school),''), ''))
        )
    )
  );

-- =========================================================================
-- 3. Feed RPC: cohort-correct (null-school isolated) + safe option identities.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_polls_feed()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_school text;
  v_handle text;
  v_ig text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('polls', '[]'::jsonb);
  END IF;
  SELECT lower(coalesce(nullif(trim(school),''), '')), handle, instagram_handle
    INTO v_school, v_handle, v_ig
  FROM public.profiles WHERE user_id = v_uid;

  WITH visible AS (
    SELECT p.*
    FROM public.polls p
    WHERE p.created_by = v_uid
       OR (v_handle IS NOT NULL AND v_handle = ANY(p.option_handles))
       OR (v_ig IS NOT NULL AND v_ig = ANY(p.option_handles))
       OR lower(coalesce(nullif(trim(p.school),''), '')) = coalesce(v_school, '')
    ORDER BY p.created_at DESC
    LIMIT 50
  ),
  tallies AS (
    SELECT v.poll_id, v.voted_handle, count(*)::int AS c
    FROM public.poll_votes v
    JOIN visible p ON p.id = v.poll_id
    GROUP BY 1,2
  ),
  mine AS (
    SELECT poll_id, voted_handle FROM public.poll_votes
    WHERE user_id = v_uid AND poll_id IN (SELECT id FROM visible)
  ),
  option_handles_all AS (
    SELECT DISTINCT unnest(option_handles) AS h FROM visible
  ),
  option_profiles AS (
    -- Only safe identity fields: handle, display name, avatar, verified flag.
    SELECT
      o.h AS handle,
      pr.name AS name,
      coalesce(pr.avatar_url, pr.instagram_avatar) AS avatar,
      (pr.instagram_verified_at IS NOT NULL) AS verified
    FROM option_handles_all o
    LEFT JOIN public.profiles pr
      ON pr.handle = o.h OR pr.instagram_handle = o.h
  )
  SELECT jsonb_build_object('polls', coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb))
  INTO v_result
  FROM (
    SELECT
      p.id, p.question, p.option_handles, p.created_at, p.created_by, p.school,
      coalesce((
        SELECT jsonb_object_agg(t.voted_handle, t.c)
        FROM tallies t WHERE t.poll_id = p.id
      ), '{}'::jsonb) AS votes,
      (SELECT voted_handle FROM mine m WHERE m.poll_id = p.id) AS my_vote,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'handle', op.handle,
          'name', op.name,
          'avatar', op.avatar,
          'verified', op.verified
        ))
        FROM option_profiles op
        WHERE op.handle = ANY(p.option_handles)
      ), '[]'::jsonb) AS option_info
    FROM visible p
    ORDER BY p.created_at DESC
  ) x;

  RETURN v_result;
END $fn$;

REVOKE ALL ON FUNCTION public.get_polls_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_polls_feed() TO authenticated, service_role;

-- =========================================================================
-- 4. cast_poll_vote: enforce feed visibility before insert.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cast_poll_vote(_poll_id uuid, _handle text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_h text;
  v_poll record;
  v_me record;
  v_visible boolean;
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
    -- Do not leak existence.
    RETURN jsonb_build_object('ok', false, 'error', 'poll_not_found');
  END IF;

  IF NOT (v_h = ANY(v_poll.option_handles)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_option');
  END IF;

  BEGIN
    INSERT INTO public.poll_votes (poll_id, user_id, voted_handle)
    VALUES (_poll_id, v_uid, v_h);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_voted');
  END;
  RETURN jsonb_build_object('ok', true);
END $fn$;

REVOKE ALL ON FUNCTION public.cast_poll_vote(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cast_poll_vote(uuid, text) TO authenticated, service_role;

-- =========================================================================
-- 5. Incoming stats RPC — anonymous aggregate counts of who voted FOR caller.
--    Never returns voter IDs or individual rows.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_my_incoming_poll_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_handle text;
  v_ig text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('results', '[]'::jsonb);
  END IF;

  SELECT handle, instagram_handle INTO v_handle, v_ig
  FROM public.profiles WHERE user_id = v_uid;

  IF v_handle IS NULL AND v_ig IS NULL THEN
    RETURN jsonb_build_object('results', '[]'::jsonb);
  END IF;

  WITH ids AS (
    SELECT unnest(ARRAY[v_handle, v_ig]) AS h
  ),
  my_ids AS (
    SELECT lower(h) AS h FROM ids WHERE h IS NOT NULL AND trim(h) <> ''
  ),
  recent AS (
    SELECT p.id, p.question, p.created_at, p.option_handles
    FROM public.polls p
    WHERE p.created_at >= now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM my_ids m WHERE m.h = ANY(p.option_handles))
    ORDER BY p.created_at DESC
    LIMIT 20
  ),
  totals AS (
    SELECT v.poll_id, count(*)::int AS total
    FROM public.poll_votes v
    JOIN recent r ON r.id = v.poll_id
    GROUP BY 1
  ),
  mine AS (
    SELECT v.poll_id, count(*)::int AS c
    FROM public.poll_votes v
    JOIN recent r ON r.id = v.poll_id
    JOIN my_ids m ON lower(v.voted_handle) = m.h
    GROUP BY 1
  )
  SELECT jsonb_build_object('results', coalesce(jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC), '[]'::jsonb))
  INTO v_result
  FROM (
    SELECT
      r.id AS poll_id,
      r.question,
      r.created_at,
      coalesce(m.c, 0) AS votes,
      coalesce(t.total, 0) AS total_votes
    FROM recent r
    LEFT JOIN totals t ON t.poll_id = r.id
    LEFT JOIN mine m ON m.poll_id = r.id
    WHERE coalesce(m.c, 0) > 0
  ) x;

  RETURN v_result;
END $fn$;

REVOKE ALL ON FUNCTION public.get_my_incoming_poll_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_incoming_poll_stats() TO authenticated, service_role;

-- =========================================================================
-- 6. Daily generator: normalize cohort key consistently (existence + insert).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.generate_daily_polls()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_created int := 0;
  v_today date := (now() at time zone 'UTC')::date;
  v_cohort record;
  v_q record;
  v_picks text[];
BEGIN
  FOR v_cohort IN
    SELECT
      lower(coalesce(nullif(trim(school),''), '')) AS cohort_key,
      nullif(trim(min(school)), '') AS canonical_school
    FROM public.profiles
    WHERE handle IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) >= 4
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.polls
      WHERE active_date = v_today
        AND lower(coalesce(nullif(trim(school),''), '')) = v_cohort.cohort_key
    ) THEN
      CONTINUE;
    END IF;

    SELECT id, text INTO v_q
    FROM public.poll_questions
    WHERE is_active = true
    ORDER BY random()
    LIMIT 1;
    IF v_q IS NULL THEN CONTINUE; END IF;

    SELECT ARRAY(
      SELECT handle FROM public.profiles
      WHERE handle IS NOT NULL
        AND lower(coalesce(nullif(trim(school),''), '')) = v_cohort.cohort_key
      ORDER BY random()
      LIMIT 4
    ) INTO v_picks;
    IF array_length(v_picks, 1) IS NULL OR array_length(v_picks, 1) < 4 THEN CONTINUE; END IF;

    BEGIN
      INSERT INTO public.polls (question, option_handles, created_by, school, question_id, active_date)
      VALUES (v_q.text, v_picks, NULL, v_cohort.canonical_school, v_q.id, v_today);
      v_created := v_created + 1;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'date', v_today);
END $fn$;

REVOKE ALL ON FUNCTION public.generate_daily_polls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_daily_polls() TO service_role;
