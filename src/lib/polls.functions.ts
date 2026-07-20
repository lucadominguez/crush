// Shim: implementation moved to src/server (D1 port).
export {
  getMyIncomingPollStats,
  submitPendingQuestion,
  logPollShare,
  getPollsFeed,
  castPollVote,
  createPollFn,
} from "@/backend/polls.functions";
export type { IncomingPollResult } from "@/backend/polls.functions";
