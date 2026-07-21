import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { reportUser } from "@/lib/profile.functions";

const REASONS = [
  "harassment or bullying",
  "sexual messages",
  "hate speech or slurs",
  "threats or self-harm",
  "spam or a fake account",
  "something else",
] as const;

/**
 * Report intake. Kept deliberately low-friction: a teen who is being harassed
 * should not have to write an essay, so a reason chip alone is a valid report
 * and the free-text note is optional.
 */
export function ReportUserSheet({
  open,
  onClose,
  reportedUserId,
  reportedName,
}: {
  open: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedName?: string | null;
}) {
  const submit = useServerFn(reportUser);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  async function send() {
    if (!reason || busy) return;
    setBusy(true);
    try {
      const full = note.trim() ? `${reason}: ${note.trim()}` : reason;
      const r = await submit({ data: { reportedUserId, reason: full } });
      if ("error" in r && r.error) { toast.error(r.error); return; }
      toast.success("Reported. Thanks for telling us.");
      onClose();
    } catch {
      toast.error("Couldn't send that report");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Report user"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md surface rounded-t-3xl rounded-b-none p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-title font-black lowercase">report {reportedName ?? "this person"}</h2>
            <p className="text-caption text-muted-foreground">they are never told you reported them</p>
          </div>
          <button ref={closeBtnRef} onClick={onClose} aria-label="Close" className="icon-btn min-w-11 min-h-11">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              aria-pressed={reason === r}
              className={reason === r ? "chip chip-primary min-h-11 px-3" : "chip min-h-11 px-3"}
            >
              {r}
            </button>
          ))}
        </div>

        <label htmlFor="report-note" className="text-label font-semibold">
          anything else? (optional)
        </label>
        <textarea
          id="report-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={400}
          className="input-field w-full p-3 text-body mt-1.5"
        />

        <button
          onClick={send}
          disabled={!reason || busy}
          className="btn-pop w-full min-h-11 mt-3 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : "send report"}
        </button>

        <p className="text-micro text-muted-foreground mt-3 text-center">
          if someone is in danger, contact local emergency services.
        </p>
      </div>
    </div>
  );
}
