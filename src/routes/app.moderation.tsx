import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldAlert, ShieldCheck, ShieldX, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import {
  actOnReport,
  amIModerator,
  getReportedUserContext,
  listReports,
  type ReportRow,
} from "@/lib/moderation.functions";

export const Route = createFileRoute("/app/moderation")({
  head: () => ({ meta: [{ title: "Reports · Crush" }] }),
  component: ModerationPage,
});

function ModerationPage() {
  const checkAccess = useServerFn(amIModerator);
  const fetchReports = useServerFn(listReports);
  const fetchContext = useServerFn(getReportedUserContext);
  const act = useServerFn(actOnReport);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openContext, setOpenContext] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ text: string; created_at: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchReports({ data: { includeHandled: false } });
      setReports(r.reports);
    } catch {
      toast.error("Couldn't load reports");
    } finally {
      setLoading(false);
    }
  }, [fetchReports]);

  useEffect(() => {
    let cancelled = false;
    checkAccess()
      .then((r) => {
        if (cancelled) return;
        setAllowed(r.moderator);
        if (r.moderator) load();
        else setLoading(false);
      })
      .catch(() => { if (!cancelled) { setAllowed(false); setLoading(false); } });
    return () => { cancelled = true; };
  }, [checkAccess, load]);

  async function decide(r: ReportRow, action: "dismissed" | "warned" | "suspended" | "unsuspended") {
    if (busy) return;
    setBusy(r.id);
    try {
      await act({ data: { reportId: r.id, targetUserId: r.reported_user_id, action } });
      toast.success(action === "dismissed" ? "Dismissed" : `Marked ${action}`);
      await load();
    } catch {
      toast.error("Couldn't record that");
    } finally {
      setBusy(null);
    }
  }

  async function showContext(r: ReportRow) {
    if (openContext === r.reported_user_id) { setOpenContext(null); return; }
    setOpenContext(r.reported_user_id);
    setMessages([]);
    try {
      const c = await fetchContext({ data: { userId: r.reported_user_id } });
      setMessages(c.messages);
    } catch {
      toast.error("Couldn't load messages");
    }
  }

  if (loading) {
    return (
      <div className="min-h-full grid place-items-center py-20">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-full px-5 pt-4 pb-8">
        <h1 className="text-[24px] font-black lowercase">reports</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          You don't have access to this page.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-full px-5 pt-4 pb-8">
      <header className="mb-5">
        <h1 className="text-[24px] font-black lowercase">reports</h1>
        <p className="text-[13px] text-muted-foreground">
          {reports.length === 0
            ? "nothing waiting. good."
            : `${reports.length} open, most-reported first`}
        </p>
      </header>

      <ul className="space-y-3">
        {reports.map((r) => (
          <li key={r.id} className="surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-[15px] truncate">
                  {r.reported_name ?? "Unknown"}{" "}
                  <span className="text-muted-foreground font-medium">@{r.reported_handle ?? "?"}</span>
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {r.report_count} report{r.report_count === 1 ? "" : "s"} total
                  {r.suspended_at ? " · currently suspended" : ""}
                </p>
              </div>
              {r.suspended_at ? (
                <ShieldX className="size-5 shrink-0 text-destructive" />
              ) : r.report_count > 2 ? (
                <ShieldAlert className="size-5 shrink-0" style={{ color: "oklch(0.7 0.16 60)" }} />
              ) : (
                <ShieldCheck className="size-5 shrink-0 text-muted-foreground" />
              )}
            </div>

            <p className="mt-3 text-[13px] rounded-xl p-3" style={{ background: "var(--muted)" }}>
              {r.reason}
            </p>

            <button
              onClick={() => showContext(r)}
              className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground min-h-11"
            >
              <MessageSquare className="size-3.5" />
              {openContext === r.reported_user_id ? "hide recent messages" : "recent messages"}
            </button>

            {openContext === r.reported_user_id && (
              <ul className="mt-1 mb-2 space-y-1.5 max-h-64 overflow-y-auto">
                {messages.length === 0 ? (
                  <li className="text-[12px] text-muted-foreground">No messages found.</li>
                ) : (
                  messages.map((m, i) => (
                    <li key={i} className="text-[12px] rounded-lg px-2.5 py-1.5" style={{ background: "var(--muted)" }}>
                      {m.text}
                    </li>
                  ))
                )}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => decide(r, "dismissed")}
                disabled={busy === r.id}
                className="min-h-11 px-4 rounded-xl surface text-[13px] font-semibold disabled:opacity-50"
              >
                dismiss
              </button>
              <button
                onClick={() => decide(r, "warned")}
                disabled={busy === r.id}
                className="min-h-11 px-4 rounded-xl surface text-[13px] font-semibold disabled:opacity-50"
              >
                warn
              </button>
              {r.suspended_at ? (
                <button
                  onClick={() => decide(r, "unsuspended")}
                  disabled={busy === r.id}
                  className="btn-pop min-h-11 px-4 disabled:opacity-50"
                >
                  {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : "unsuspend"}
                </button>
              ) : (
                <button
                  onClick={() => decide(r, "suspended")}
                  disabled={busy === r.id}
                  className="min-h-11 px-4 rounded-xl text-[13px] font-semibold disabled:opacity-50"
                  style={{ background: "var(--destructive)", color: "var(--destructive-foreground)" }}
                >
                  {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : "suspend"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
