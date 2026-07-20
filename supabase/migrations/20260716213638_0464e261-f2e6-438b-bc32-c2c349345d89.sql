
REVOKE ALL ON FUNCTION public.claim_referral(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_referral(text) FROM anon;
REVOKE ALL ON FUNCTION public.repair_missing_referral() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_missing_referral() FROM anon;
REVOKE ALL ON FUNCTION public.referral_slot_target(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.referral_slot_target(integer) FROM anon;

GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.repair_missing_referral() TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_missing_referral() TO service_role;
GRANT EXECUTE ON FUNCTION public.referral_slot_target(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_slot_target(integer) TO service_role;
