// Shim: implementation moved to src/server (D1 port).
export {
  getMyIncomingPollStats,
  submitPendingQuestion,
  logPollShare,
  getPollsFeed,
  castPollVote,
  createPollFn,
} from "@/server/polls.functions";
export type { IncomingPollResult } from "@/server/polls.functions";
