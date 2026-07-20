
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS school text,
  ADD COLUMN IF NOT EXISTS city text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name TEXT;
  v_handle TEXT;
  v_school TEXT;
  v_city TEXT;
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
  v_school := NULLIF(trim(NEW.raw_user_meta_data->>'school'), '');
  v_city := NULLIF(trim(NEW.raw_user_meta_data->>'city'), '');
  INSERT INTO public.profiles (user_id, name, handle, school, city)
  VALUES (NEW.id, v_name, v_handle, v_school, v_city);
  RETURN NEW;
END $function$;
