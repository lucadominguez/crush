
-- =========================================================================
-- 1. Poll vote privacy: remove broad SELECT, allow only own row reads.
-- =========================================================================
DROP POLICY IF EXISTS "Poll vote totals viewable by authenticated users" ON public.poll_votes;
DROP POLICY IF EXISTS "Users view own vote" ON public.poll_votes;
CREATE POLICY "Users view own vote" ON public.poll_votes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- =========================================================================
-- 2. Polls SELECT scoped to caller cohort / creator / option target.
--    Existing "Polls viewable by authenticated users" (using true) is dropped.
-- =========================================================================
DROP POLICY IF EXISTS "Polls viewable by authenticated users" ON public.polls;
DROP POLICY IF EXISTS "Polls viewable in cohort" ON public.polls;
CREATE POLICY "Polls viewable in cohort" ON public.polls
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.user_id = auth.uid()
        AND (
          polls.school IS NULL
          OR lower(coalesce(polls.school,'')) = lower(coalesce(me.school,''))
          OR me.handle = ANY(polls.option_handles)
          OR (me.instagram_handle IS NOT NULL AND me.instagram_handle = ANY(polls.option_handles))
        )
    )
  );

-- =========================================================================
-- 3. RPC: get_polls_feed — returns anonymous counts + caller's own vote.
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
  SELECT lower(coalesce(school,'')), handle, instagram_handle
    INTO v_school, v_handle, v_ig
  FROM public.profiles WHERE user_id = v_uid;

  WITH visible AS (
    SELECT p.*
    FROM public.polls p
    WHERE p.created_by = v_uid
       OR p.school IS NULL
       OR lower(coalesce(p.school,'')) = coalesce(v_school,'')
       OR v_handle = ANY(p.option_handles)
       OR (v_ig IS NOT NULL AND v_ig = ANY(p.option_handles))
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
      (SELECT voted_handle FROM mine m WHERE m.poll_id = p.id) AS my_vote
    FROM visible p
    ORDER BY p.created_at DESC
  ) x;

  RETURN v_result;
END $fn$;

REVOKE ALL ON FUNCTION public.get_polls_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_polls_feed() TO authenticated, service_role;

-- =========================================================================
-- 4. RPC: cast_poll_vote — atomic, validated, unique.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cast_poll_vote(_poll_id uuid, _handle text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_opts text[];
  v_h text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  v_h := lower(regexp_replace(coalesce(_handle,''), '^@', ''));
  IF v_h = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_option');
  END IF;
  SELECT option_handles INTO v_opts FROM public.polls WHERE id = _poll_id;
  IF v_opts IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'poll_not_found');
  END IF;
  IF NOT (v_h = ANY(v_opts)) THEN
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
-- 5. RPC: create_poll — validated, rate limited 3/24h.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_poll(_question text, _handles text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_q text;
  v_opts text[];
  v_school text;
  v_count int;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  v_q := trim(coalesce(_question, ''));
  IF length(v_q) < 5 OR length(v_q) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_question');
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT lower(regexp_replace(h, '^@', ''))
    FROM unnest(coalesce(_handles, ARRAY[]::text[])) AS h
    WHERE trim(coalesce(h,'')) <> ''
  ) INTO v_opts;

  IF array_length(v_opts, 1) IS NULL OR array_length(v_opts, 1) < 2 OR array_length(v_opts, 1) > 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_options');
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.polls
  WHERE created_by = v_uid
    AND created_at > now() - interval '24 hours';
  IF v_count >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  SELECT school INTO v_school FROM public.profiles WHERE user_id = v_uid;

  INSERT INTO public.polls (question, option_handles, created_by, school)
  VALUES (v_q, v_opts, v_uid, v_school)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;

REVOKE ALL ON FUNCTION public.create_poll(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_poll(text, text[]) TO authenticated, service_role;

-- Keep direct INSERT policy but require created_by = auth.uid() (still guarded);
-- the RPC path is preferred. No change needed to existing INSERT policy.

-- =========================================================================
-- 6. Daily poll generator — DB-local, cohort-scoped, idempotent, closed by default.
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
    SELECT lower(coalesce(school,'')) AS cohort_key, school
    FROM public.profiles
    WHERE handle IS NOT NULL
    GROUP BY 1, 2
    HAVING COUNT(*) >= 4
  LOOP
    -- Skip cohort if already has a poll for today
    IF EXISTS (
      SELECT 1 FROM public.polls
      WHERE active_date = v_today
        AND coalesce(school,'') = coalesce(v_cohort.school,'')
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
        AND lower(coalesce(school,'')) = v_cohort.cohort_key
      ORDER BY random()
      LIMIT 4
    ) INTO v_picks;
    IF array_length(v_picks, 1) IS NULL OR array_length(v_picks, 1) < 4 THEN CONTINUE; END IF;

    BEGIN
      INSERT INTO public.polls (question, option_handles, created_by, school, question_id, active_date)
      VALUES (v_q.text, v_picks, NULL, v_cohort.school, v_q.id, v_today);
      v_created := v_created + 1;
    EXCEPTION WHEN unique_violation THEN
      -- concurrent generator or duplicate — ignore
      NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'date', v_today);
END $fn$;

REVOKE ALL ON FUNCTION public.generate_daily_polls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_daily_polls() TO service_role;

-- =========================================================================
-- 7. Unschedule legacy HTTP cron jobs, install single DB-local schedule.
-- =========================================================================
DO $cron$
DECLARE
  j record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    FOR j IN
      SELECT jobid, jobname FROM cron.job
      WHERE command ILIKE '%daily-poll%'
         OR jobname ILIKE '%daily%poll%'
    LOOP
      PERFORM cron.unschedule(j.jobid);
    END LOOP;

    -- Idempotent (re)schedule of the DB-local generator, once per day at 13:00 UTC.
    PERFORM cron.schedule(
      'generate-daily-polls',
      '0 13 * * *',
      $sql$SELECT public.generate_daily_polls();$sql$
    );
  END IF;
END $cron$;
