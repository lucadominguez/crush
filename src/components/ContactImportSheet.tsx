import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Lock, MessageSquare, ShieldCheck, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { importContacts, getInviteTargets } from "@/lib/contacts.functions";
import { getMyInviteText, logInvite } from "@/lib/phase5.functions";

type Step = "consent" | "picking" | "targets";
type Target = { phoneHash: string; name: string | null; school: string | null; reach: string };

// Contact Picker API — Android Chrome only, and not in the TS DOM lib.
type PickedContact = { name?: string[]; tel?: string[] };
type ContactsManager = {
  select: (props: string[], opts?: { multiple?: boolean }) => Promise<PickedContact[]>;
};
function contactPicker(): ContactsManager | null {
  if (typeof navigator === "undefined") return null;
  const c = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return c && typeof c.select === "function" ? c : null;
}

/** Parse the manual fallback: one contact per line, "Name, +1 555 0100" or just a number. */
function parsePasted(raw: string): { phone: string; name: string | null }[] {
  return raw
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)[,;\t]\s*(.+)$/);
      if (m && /\d/.test(m[2])) return { name: m[1].trim() || null, phone: m[2].trim() };
      return { name: null, phone: line };
    })
    .filter((c) => (c.phone.match(/\d/g) ?? []).length >= 7);
}

export function ContactImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const doImport = useServerFn(importContacts);
  const fetchTargets = useServerFn(getInviteTargets);
  const fetchText = useServerFn(getMyInviteText);
  const log = useServerFn(logInvite);

  const [step, setStep] = useState<Step>("consent");
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [inviteText, setInviteText] = useState("");
  const [sent, setSent] = useState<Set<string>>(new Set());

  // hash -> phone, built from what THIS client uploaded. Never persisted.
  const phoneByHash = useRef<Map<string, string>>(new Map());
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("consent");
    setShowPaste(false);
    setPasted("");
    setSent(new Set());
    prevFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const list = Array.from(
        root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      prevFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  const submit = useCallback(
    async (contacts: { phone: string; name: string | null }[]) => {
      if (!contacts.length) { toast.error("No usable numbers found"); return; }
      setBusy(true);
      try {
        const res = await doImport({ data: { consent: true, contacts } });
        if (!res.ok) { toast.error("Import failed, try again"); return; }
        for (const m of res.map) phoneByHash.current.set(m.hash, m.e164);

        const [t, txt] = await Promise.all([fetchTargets({ data: { limit: 40 } }), fetchText({ data: { origin: window.location.origin } })]);
        setTargets(t.targets);
        setInviteText(txt.text);
        setStep("targets");
        toast.success(`${res.imported} contact${res.imported === 1 ? "" : "s"} added`);
      } catch {
        toast.error("Import failed, try again");
      } finally {
        setBusy(false);
      }
    },
    [doImport, fetchTargets, fetchText],
  );

  async function pickFromDevice() {
    const picker = contactPicker();
    if (!picker) { setShowPaste(true); return; }
    setStep("picking");
    try {
      const picked = await picker.select(["name", "tel"], { multiple: true });
      const contacts = picked.flatMap((p) =>
        (p.tel ?? []).map((tel) => ({ phone: tel, name: p.name?.[0] ?? null })),
      );
      await submit(contacts);
    } catch {
      setStep("consent");
    }
  }

  async function invite(t: Target) {
    const phone = phoneByHash.current.get(t.phoneHash);
    if (!phone) { toast.error("Re-import your contacts to invite this person"); return; }
    await log({ data: { phone, channel: "sms" } }).catch(() => null);
    setSent((s) => new Set(s).add(t.phoneHash));
    const sep = /android/i.test(navigator.userAgent) ? "?" : "&";
    window.location.href = `sms:${phone}${sep}body=${encodeURIComponent(inviteText)}`;
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Find friends from contacts"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md surface rounded-t-3xl rounded-b-none p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-[18px] font-black lowercase">find your friends</h2>
            <p className="text-[12px] text-muted-foreground">see who is already here, invite who is not</p>
          </div>
          <button ref={closeBtnRef} onClick={onClose} aria-label="Close" className="icon-btn min-w-11 min-h-11">
            <X className="size-5" />
          </button>
        </div>

        {step === "consent" && (
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Crush can check which of your contacts are already here, and rank who is
              worth inviting. Your contacts stay private.
            </p>

            <ul className="space-y-3 text-[13px]">
              <li className="flex gap-3">
                <Lock className="size-4 mt-0.5 shrink-0 text-primary" />
                <span>Numbers are encrypted before they are stored. We never keep a readable copy.</span>
              </li>
              <li className="flex gap-3">
                <ShieldCheck className="size-4 mt-0.5 shrink-0 text-primary" />
                <span>Nobody is ever told that you uploaded them, or that you have them saved.</span>
              </li>
              <li className="flex gap-3">
                <MessageSquare className="size-4 mt-0.5 shrink-0 text-primary" />
                <span>Invites are sent by you, from your own messages app. We do not text your contacts on our own.</span>
              </li>
            </ul>

            {showPaste ? (
              <div className="space-y-2">
                <label htmlFor="paste-contacts" className="text-[13px] font-semibold">
                  Paste contacts, one per line
                </label>
                <textarea
                  id="paste-contacts"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={6}
                  placeholder={"Jamie, +1 555 0100\nSam, 555 0111"}
                  className="input-field w-full p-3 text-[14px]"
                />
                <button
                  onClick={() => submit(parsePasted(pasted))}
                  disabled={busy || !pasted.trim()}
                  className="btn-pop w-full min-h-11 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-4 animate-spin mx-auto" /> : "Add these contacts"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={pickFromDevice}
                  disabled={busy}
                  className="btn-pop w-full min-h-11 inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Upload className="size-4" />
                  Choose contacts
                </button>
                <button
                  onClick={() => setShowPaste(true)}
                  className="w-full min-h-11 rounded-xl surface inline-flex items-center justify-center text-[14px] font-semibold"
                >
                  Or paste them manually
                </button>
              </div>
            )}
          </div>
        )}

        {step === "picking" && (
          <div className="py-10 grid place-items-center gap-3">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-[13px] text-muted-foreground">Waiting for your contact picker</p>
          </div>
        )}

        {step === "targets" && (
          <div className="space-y-3">
            {targets.length === 0 ? (
              <p className="text-[13px] py-6 text-center text-muted-foreground">
                Everyone we recognized is already on Crush. Nice network.
              </p>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground">
                  These people are not on Crush yet. The ones at the top are in the most friend groups.
                </p>
                <ul className="space-y-2">
                  {targets.map((t) => {
                    const done = sent.has(t.phoneHash);
                    return (
                      <li key={t.phoneHash} className="flex items-center gap-3 p-3 rounded-xl surface">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{t.name ?? "Unsaved contact"}</p>
                          {t.reach === "high" && (
                            <p className="text-[12px] text-muted-foreground">In a lot of friend groups</p>
                          )}
                        </div>
                        <button
                          onClick={() => invite(t)}
                          disabled={done}
                          className={done ? "chip shrink-0 min-h-11 px-3" : "btn-pop shrink-0 min-h-11 px-4"}
                        >
                          {done ? <Check className="size-4" /> : "Invite"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
