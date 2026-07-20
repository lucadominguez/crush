
ALTER TABLE public.polls ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE POLICY "Users create their own polls"
ON public.polls
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

DELETE FROM public.poll_votes WHERE poll_id IN (SELECT id FROM public.polls WHERE created_by IS NULL);
DELETE FROM public.polls WHERE created_by IS NULL;
