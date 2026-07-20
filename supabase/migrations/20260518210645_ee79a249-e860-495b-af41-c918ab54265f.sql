
-- =========== PROFILES ===========
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL DEFAULT '✨',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert their own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- =========== CRUSHES (strictly private) ===========
CREATE TABLE public.crushes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, target_handle)
);
ALTER TABLE public.crushes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner views own crushes"
  ON public.crushes FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner adds own crush"
  ON public.crushes FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner deletes own crush"
  ON public.crushes FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- =========== MATCHES ===========
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Match participants view their match"
  ON public.matches FOR SELECT TO authenticated
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- =========== MESSAGES ===========
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_match_participant(_match_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches
    WHERE id = _match_id AND (_user_id = user_a_id OR _user_id = user_b_id)
  )
$$;

CREATE POLICY "Match participants view messages"
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_match_participant(match_id, auth.uid()));
CREATE POLICY "Match participants send messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = from_user_id AND public.is_match_participant(match_id, auth.uid()));

-- =========== POLLS ===========
CREATE TABLE public.polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  option_handles TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Polls viewable by authenticated users"
  ON public.polls FOR SELECT TO authenticated USING (true);

CREATE TABLE public.poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voted_handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id)
);
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Poll vote totals viewable by authenticated users"
  ON public.poll_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users cast their own vote"
  ON public.poll_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- =========== TIMESTAMP HELPER ===========
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER tr_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =========== AUTO-CREATE PROFILE ON SIGNUP ===========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT;
  v_handle TEXT;
BEGIN
  v_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''), split_part(NEW.email, '@', 1));
  v_handle := lower(regexp_replace(
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'handle'), ''), split_part(NEW.email, '@', 1)),
    '[^a-z0-9_.]', '', 'gi'
  ));
  IF v_handle = '' THEN v_handle := 'user' || floor(random()*100000)::text; END IF;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE handle = v_handle) LOOP
    v_handle := v_handle || floor(random()*1000)::text;
  END LOOP;
  INSERT INTO public.profiles (user_id, name, handle) VALUES (NEW.id, v_name, v_handle);
  RETURN NEW;
END $$;

CREATE TRIGGER tr_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========== AUTO-MATCH ON RECIPROCAL CRUSH ===========
CREATE OR REPLACE FUNCTION public.check_match_on_crush()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_user_id UUID;
  v_my_handle TEXT;
BEGIN
  NEW.target_handle := lower(regexp_replace(NEW.target_handle, '^@', ''));
  SELECT user_id INTO v_target_user_id FROM public.profiles WHERE handle = NEW.target_handle;
  IF v_target_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT handle INTO v_my_handle FROM public.profiles WHERE user_id = NEW.owner_id;
  IF v_my_handle IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.crushes
    WHERE owner_id = v_target_user_id AND target_handle = v_my_handle
  ) AND NOT EXISTS (
    SELECT 1 FROM public.matches
    WHERE (user_a_id = NEW.owner_id AND user_b_id = v_target_user_id)
       OR (user_a_id = v_target_user_id AND user_b_id = NEW.owner_id)
  ) THEN
    INSERT INTO public.matches (user_a_id, user_b_id) VALUES (NEW.owner_id, v_target_user_id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tr_crushes_match_check
  BEFORE INSERT ON public.crushes
  FOR EACH ROW EXECUTE FUNCTION public.check_match_on_crush();

-- =========== SEED POLLS ===========
INSERT INTO public.polls (question, option_handles) VALUES
('Who is most likely to be the main character?', ARRAY['miakim','jordanlee','lucamartin','isaflores']),
('Most likely to text back in 3 seconds?',       ARRAY['samchen','tygreen','noahb','zoey.w']),
('Who''s secretly a 10/10 dancer?',              ARRAY['kaihernandez','ellie.r','devonp','amaranthe']),
('Best plus-one to a party?',                     ARRAY['jaykwon','ryanp','soph.m','alexrivera']),
('Who''d win a karaoke battle?',                  ARRAY['noahb','isaflores','lucamartin','miakim']);

-- =========== REALTIME ===========
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
