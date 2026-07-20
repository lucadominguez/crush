-- Tighten conversation_reads SELECT to require current participation, matching
-- the INSERT/UPDATE predicate. Stale rows from left conversations become
-- inaccessible without deleting or exposing them.
DROP POLICY IF EXISTS "Own reads select" ON public.conversation_reads;
CREATE POLICY "Own reads select"
  ON public.conversation_reads
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND (
      (kind = 'match' AND public.is_match_participant(conv_id, auth.uid()))
      OR (kind = 'group' AND public.is_group_member(conv_id, auth.uid()))
    )
  );

-- Belt-and-suspenders: ensure no anon/public execute or table privileges.
REVOKE ALL ON public.conversation_reads FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.conversation_reads TO authenticated;
GRANT ALL ON public.conversation_reads TO service_role;