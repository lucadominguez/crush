// Shim: implementation moved to src/backend (D1 port).
export {
  amIModerator,
  listReports,
  getReportedUserContext,
  actOnReport,
} from "@/backend/moderation.functions";
export type { ReportRow } from "@/backend/moderation.functions";
