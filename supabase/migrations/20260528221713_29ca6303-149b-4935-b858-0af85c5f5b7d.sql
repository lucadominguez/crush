-- Group chats
CREATE TABLE public.group_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '✨',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_chats TO authenticated;
GRANT ALL ON public.group_chats TO service_role;
ALTER TABLE public.group_chats ENABLE ROW LEVEL SECURITY;

-- Group members
CREATE TABLE public.group_members (
  group_id uuid NOT NULL REFERENCES public.group_chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON public.group_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_members TO authenticated;
GRANT ALL ON public.group_members TO service_role;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Helper function (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = _group_id AND user_id = _user_id
  )
$$;

-- Group messages
CREATE TABLE public.group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.group_chats(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_group_messages_group ON public.group_messages(group_id, created_at);
GRANT SELECT, INSERT ON public.group_messages TO authenticated;
GRANT ALL ON public.group_messages TO service_role;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

-- Policies: group_chats
CREATE POLICY "Members view their groups"
ON public.group_chats FOR SELECT TO authenticated
USING (public.is_group_member(id, auth.uid()));

CREATE POLICY "Authenticated create groups"
ON public.group_chats FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Members update group meta"
ON public.group_chats FOR UPDATE TO authenticated
USING (public.is_group_member(id, auth.uid()));

-- Policies: group_members
CREATE POLICY "Members view membership of their groups"
ON public.group_members FOR SELECT TO authenticated
USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "Members add other members"
ON public.group_members FOR INSERT TO authenticated
WITH CHECK (
  -- creator bootstrapping themselves OR existing member adding someone
  public.is_group_member(group_id, auth.uid())
  OR EXISTS (SELECT 1 FROM public.group_chats g WHERE g.id = group_id AND g.created_by = auth.uid())
);

CREATE POLICY "Users remove themselves"
ON public.group_members FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Policies: group_messages
CREATE POLICY "Members view group messages"
ON public.group_messages FOR SELECT TO authenticated
USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "Members send group messages"
ON public.group_messages FOR INSERT TO authenticated
WITH CHECK (auth.uid() = from_user_id AND public.is_group_member(group_id, auth.uid()));

-- Bump last_message_at when new message arrives
CREATE OR REPLACE FUNCTION public.touch_group_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.group_chats SET last_message_at = now() WHERE id = NEW.group_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_group_on_message
AFTER INSERT ON public.group_messages
FOR EACH ROW EXECUTE FUNCTION public.touch_group_on_message();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;