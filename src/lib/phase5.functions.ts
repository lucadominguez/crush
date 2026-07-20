// Shim: implementation moved to src/server (D1 port).
export {
  logInvite,
  getMyInviteText,
  claimReferralCode,
  repairMissingReferral,
  getReferralStats,
  getMyHintEligibility,
  revealHint,
  listMyHints,
  getCrushOfWeek,
} from "@/server/growth.functions";
export type WeeklySuperlative = {
  id: string;
  school: string | null;
  week_start: string;
  question: string;
  winner_handle: string;
  votes: number;
};
