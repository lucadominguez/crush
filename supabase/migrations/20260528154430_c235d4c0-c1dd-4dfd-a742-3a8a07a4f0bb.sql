CREATE INDEX IF NOT EXISTS idx_messages_match_created ON public.messages (match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON public.matches (user_a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON public.matches (user_b_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crushes_target_handle ON public.crushes (target_handle);
CREATE INDEX IF NOT EXISTS idx_crushes_owner_created ON public.crushes (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_match_id ON public.messages (match_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON public.poll_votes (poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_user ON public.poll_votes (user_id);