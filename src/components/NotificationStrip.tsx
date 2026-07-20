import { useStreak } from "@/lib/phase1.hooks";
import { SocialProofStrip } from "@/components/SocialProofStrip";

export function NotificationStrip() {
  const streak = useStreak();
  return <SocialProofStrip streak={streak} />;
}
