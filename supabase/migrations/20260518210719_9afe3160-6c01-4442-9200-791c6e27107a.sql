
CREATE OR REPLACE FUNCTION public.is_match_participant(_match_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches
    WHERE id = _match_id AND (_user_id = user_a_id OR _user_id = user_b_id)
  )
$$;
