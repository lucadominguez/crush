
-- 1) Idempotency key for chat messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_id text;
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_id_unique
  ON public.messages (match_id, from_user_id, client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE public.group_messages ADD COLUMN IF NOT EXISTS client_id text;
CREATE UNIQUE INDEX IF NOT EXISTS group_messages_client_id_unique
  ON public.group_messages (group_id, from_user_id, client_id)
  WHERE client_id IS NOT NULL;

-- 2) Durable per-user conversation read state
CREATE TABLE IF NOT EXISTS public.conversation_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('match','group')),
  conv_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, conv_id)
);

GRANT SELECT, INSERT, UPDATE ON public.conversation_reads TO authenticated;
GRANT ALL ON public.conversation_reads TO service_role;

ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own reads select" ON public.conversation_reads;
CREATE POLICY "Own reads select" ON public.conversation_reads
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own reads insert" ON public.conversation_reads;
CREATE POLICY "Own reads insert" ON public.conversation_reads
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND (
      (kind = 'match' AND public.is_match_participant(conv_id, auth.uid()))
      OR (kind = 'group' AND public.is_group_member(conv_id, auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Own reads update" ON public.conversation_reads;
CREATE POLICY "Own reads update" ON public.conversation_reads
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND (
      (kind = 'match' AND public.is_match_participant(conv_id, auth.uid()))
      OR (kind = 'group' AND public.is_group_member(conv_id, auth.uid()))
    )
  );

-- 3) Mark-read RPC (server timestamp, membership-enforced)
CREATE OR REPLACE FUNCTION public.mark_conversation_read(_kind text, _conv_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF _kind NOT IN ('match','group') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_kind');
  END IF;
  IF _kind = 'match' AND NOT public.is_match_participant(_conv_id, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF _kind = 'group' AND NOT public.is_group_member(_conv_id, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  INSERT INTO public.conversation_reads (user_id, kind, conv_id, last_read_at)
  VALUES (v_uid, _kind, _conv_id, now())
  ON CONFLICT (user_id, kind, conv_id) DO UPDATE SET last_read_at = now()
  RETURNING last_read_at INTO v_at;
  RETURN jsonb_build_object('ok', true, 'at', v_at);
END $$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_conversation_read(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(text, uuid) TO service_role;

-- 4) Truthful per-conversation latest previews (no arbitrary limit)
CREATE OR REPLACE FUNCTION public.latest_match_previews()
RETURNS TABLE(match_id uuid, from_user_id uuid, text text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.match_id) m.match_id, m.from_user_id, m.text, m.created_at
  FROM public.messages m
  JOIN public.matches mt ON mt.id = m.match_id
  WHERE mt.user_a_id = auth.uid() OR mt.user_b_id = auth.uid()
  ORDER BY m.match_id, m.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.latest_match_previews() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.latest_match_previews() FROM anon;
GRANT EXECUTE ON FUNCTION public.latest_match_previews() TO authenticated;
GRANT EXECUTE ON FUNCTION public.latest_match_previews() TO service_role;

CREATE OR REPLACE FUNCTION public.latest_group_previews()
RETURNS TABLE(group_id uuid, from_user_id uuid, text text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (gm.group_id) gm.group_id, gm.from_user_id, gm.text, gm.created_at
  FROM public.group_messages gm
  WHERE public.is_group_member(gm.group_id, auth.uid())
  ORDER BY gm.group_id, gm.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.latest_group_previews() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.latest_group_previews() FROM anon;
GRANT EXECUTE ON FUNCTION public.latest_group_previews() TO authenticated;
GRANT EXECUTE ON FUNCTION public.latest_group_previews() TO service_role;

-- 5) Atomic group creation (validates + adds all memberships in one txn)
CREATE OR REPLACE FUNCTION public.create_group_atomic(_name text, _emoji text, _member_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_emoji text;
  v_ids uuid[];
  v_valid_count int;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  v_name := trim(coalesce(_name, ''));
  IF length(v_name) = 0 OR length(v_name) > 48 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_name');
  END IF;
  v_emoji := coalesce(nullif(trim(_emoji), ''), '✨');

  -- dedupe and exclude creator (creator is always included below)
  SELECT ARRAY(
    SELECT DISTINCT u FROM unnest(coalesce(_member_ids, ARRAY[]::uuid[])) AS u
    WHERE u IS NOT NULL AND u <> v_uid
  ) INTO v_ids;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL OR array_length(v_ids, 1) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_members');
  END IF;

  SELECT count(*) INTO v_valid_count FROM public.profiles WHERE user_id = ANY(v_ids);
  IF v_valid_count <> array_length(v_ids, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_members');
  END IF;

  INSERT INTO public.group_chats (name, emoji, created_by)
  VALUES (v_name, v_emoji, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.group_members (group_id, user_id)
  SELECT v_id, u FROM unnest(v_ids || ARRAY[v_uid]) AS u
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $$;

REVOKE ALL ON FUNCTION public.create_group_atomic(text, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_group_atomic(text, text, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_group_atomic(text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_group_atomic(text, text, uuid[]) TO service_role;
