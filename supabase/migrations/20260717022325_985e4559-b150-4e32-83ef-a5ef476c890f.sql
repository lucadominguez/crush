
-- Match created: notify both participants
CREATE OR REPLACE FUNCTION public.notify_on_match_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES
    (NEW.user_a_id, 'match_created', jsonb_build_object('match_id', NEW.id)),
    (NEW.user_b_id, 'match_created', jsonb_build_object('match_id', NEW.id));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_match_created ON public.matches;
CREATE TRIGGER trg_notify_on_match_created
  AFTER INSERT ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_match_created();

-- DM message: notify the OTHER participant
CREATE OR REPLACE FUNCTION public.notify_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a uuid; v_b uuid; v_other uuid;
BEGIN
  SELECT user_a_id, user_b_id INTO v_a, v_b FROM public.matches WHERE id = NEW.match_id;
  IF v_a IS NULL THEN RETURN NEW; END IF;
  v_other := CASE WHEN NEW.from_user_id = v_a THEN v_b ELSE v_a END;
  IF v_other IS NULL OR v_other = NEW.from_user_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (v_other, 'message_received',
          jsonb_build_object('match_id', NEW.match_id, 'message_id', NEW.id));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_message ON public.messages;
CREATE TRIGGER trg_notify_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_message();

-- Group message: notify every OTHER current member
CREATE OR REPLACE FUNCTION public.notify_on_group_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, payload)
  SELECT gm.user_id, 'group_message_received',
         jsonb_build_object('group_id', NEW.group_id, 'message_id', NEW.id)
    FROM public.group_members gm
   WHERE gm.group_id = NEW.group_id
     AND gm.user_id <> NEW.from_user_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_group_message ON public.group_messages;
CREATE TRIGGER trg_notify_on_group_message
  AFTER INSERT ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_group_message();

-- Poll vote: notify the person voted for, unless self
CREATE OR REPLACE FUNCTION public.notify_on_poll_vote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target uuid;
  v_h text;
BEGIN
  v_h := lower(regexp_replace(coalesce(NEW.voted_handle,''), '^@', ''));
  IF v_h = '' THEN RETURN NEW; END IF;
  SELECT user_id INTO v_target
    FROM public.profiles
   WHERE handle = v_h OR instagram_handle = v_h
   LIMIT 1;
  IF v_target IS NULL OR v_target = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (v_target, 'poll_voted_for', jsonb_build_object('poll_id', NEW.poll_id));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_poll_vote ON public.poll_votes;
CREATE TRIGGER trg_notify_on_poll_vote
  AFTER INSERT ON public.poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_poll_vote();

-- Referral: notify referrer, indicating milestone crossing only (no identity)
CREATE OR REPLACE FUNCTION public.notify_on_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_milestone boolean;
BEGIN
  IF NEW.referrer_id IS NULL OR NEW.referrer_id = NEW.referred_user_id THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.referrals WHERE referrer_id = NEW.referrer_id;
  v_milestone := (v_count > 0 AND (v_count % 3) = 0 AND (v_count / 3) <= 5);
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (NEW.referrer_id, 'referral_joined',
          jsonb_build_object('milestone', v_milestone, 'total', v_count));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_referral ON public.referrals;
CREATE TRIGGER trg_notify_on_referral
  AFTER INSERT ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_referral();

-- Lock down direct execution of the trigger functions (triggers still fire as owner).
REVOKE ALL ON FUNCTION public.notify_on_match_created()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_message()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_group_message()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_poll_vote()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_referral()        FROM PUBLIC, anon, authenticated;
