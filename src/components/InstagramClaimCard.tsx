import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, Instagram, Loader2, Copy, Check, X } from "lucide-react";
import { toast } from "sonner";
import { getInstagramProfile, type IGProfile } from "@/lib/instagram.functions";
import {
  claimInstagramHandle,
  startInstagramVerification,
  verifyInstagramBio,
} from "@/lib/profile.functions";
import { useMyProfile } from "@/lib/store";

type Mode = "idle" | "preview" | "verify";

export function InstagramClaimCard() {
  const { data: me, refresh } = useMyProfile();
  const fetchProfile = useServerFn(getInstagramProfile);
  const doClaim = useServerFn(claimInstagramHandle);
  const doStart = useServerFn(startInstagramVerification);
  const doVerify = useServerFn(verifyInstagramBio);

  const [mode, setMode] = useState<Mode>("idle");
  const [handle, setHandle] = useState("");
  const [preview, setPreview] = useState<IGProfile | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!me) return null;

  // Already verified · show compact badge
  if (me.instagram_verified_at) {
    return (
      <div className="card-pop p-4 flex items-center gap-3 bg-gradient-bubble">
        <div className="size-12 rounded-full bg-card border-2 border-foreground overflow-hidden flex items-center justify-center">
          {me.instagram_avatar ? (
            <img
              src={`/api/ig-avatar?u=${encodeURIComponent(me.instagram_avatar)}`}
              alt={me.instagram_handle ?? ""}
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Instagram className="size-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold truncate flex items-center gap-1">
            @{me.instagram_handle}
            <BadgeCheck className="size-4 text-accent fill-accent/30" />
          </p>
          <p className="text-xs text-muted-foreground">instagram verified</p>
        </div>
      </div>
    );
  }

  // Claimed but not verified
  if (me.instagram_handle && mode === "idle") {
    return (
      <div className="card-pop p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-full bg-card border-2 border-foreground overflow-hidden flex items-center justify-center">
            {me.instagram_avatar ? (
              <img
                src={`/api/ig-avatar?u=${encodeURIComponent(me.instagram_avatar)}`}
                alt={me.instagram_handle}
                className="size-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Instagram className="size-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold truncate">@{me.instagram_handle}</p>
            <p className="text-xs text-muted-foreground">claimed · not verified yet</p>
          </div>
        </div>
        <button
          onClick={() => startVerify()}
          disabled={busy}
          className="btn-pop w-full text-sm"
        >
          {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : <BadgeCheck className="size-4 mr-2" />}
          verify with bio code
        </button>
      </div>
    );
  }

  // Verify mode (showing the code)
  if (mode === "verify") {
    return (
      <div className="card-pop p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-black text-base">verify @{me.instagram_handle}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              paste this code anywhere in your instagram bio, then tap verify.
            </p>
          </div>
          <button onClick={() => setMode("idle")} className="size-7 rounded-full bg-secondary border-2 border-foreground flex items-center justify-center">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2.5 rounded-xl bg-secondary border-2 border-foreground font-mono font-bold text-sm">
            {code}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="size-11 rounded-xl bg-card border-2 border-foreground flex items-center justify-center tap-scale"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </div>
        <button
          onClick={() => doVerifyNow()}
          disabled={busy}
          className="btn-pop w-full text-sm disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : <BadgeCheck className="size-4 mr-2" />}
          i added it · verify now
        </button>
        <p className="text-[11px] text-muted-foreground text-center">
          you can remove the code from your bio after verification.
        </p>
      </div>
    );
  }

  // Preview mode (after handle lookup)
  if (mode === "preview" && preview) {
    return (
      <div className="card-pop p-4 space-y-3">
        <p className="font-black text-base">is this you?</p>
        <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary border-2 border-foreground">
          <div className="size-14 rounded-full bg-card border-2 border-foreground overflow-hidden flex items-center justify-center">
            {preview.avatar ? (
              <img src={preview.avatar} alt={preview.handle} className="size-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <Instagram className="size-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold truncate flex items-center gap-1">
              {preview.name}
              {preview.verified && <BadgeCheck className="size-3.5 text-accent fill-accent/30" />}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              @{preview.handle} · {fmtCount(preview.followers)} followers
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setMode("idle"); setPreview(null); }}
            className="flex-1 rounded-full px-4 py-2.5 bg-card border-2 border-foreground font-bold text-sm tap-scale"
          >
            not me
          </button>
          <button
            onClick={() => confirmClaim()}
            disabled={busy}
            className="btn-pop flex-1 text-sm disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            yes, that's me
          </button>
        </div>
      </div>
    );
  }

  // Idle · input form
  return (
    <div className="card-pop p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Instagram className="size-5" />
        <p className="font-black text-base">Link your Instagram</p>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Helps others recognize you when you match. Takes 10 seconds.
      </p>
      <div className="flex gap-2">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@yourhandle"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 bg-secondary border-2 border-foreground rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-ring text-sm font-medium"
        />
        <button
          onClick={() => lookup()}
          disabled={busy || handle.trim().length < 1}
          className="btn-pop text-sm px-4 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Find"}
        </button>
      </div>
    </div>
  );

  async function lookup() {
    const h = handle.trim().replace(/^@/, "");
    if (!h) return;
    setBusy(true);
    try {
      const r = await fetchProfile({ data: { handle: h } });
      if (!r.profile) {
        toast.error("couldn't find that instagram account.");
        return;
      }
      setPreview(r.profile);
      setMode("preview");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "lookup failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmClaim() {
    if (!preview) return;
    setBusy(true);
    const r = await doClaim({ data: { handle: preview.handle } });
    setBusy(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success(`claimed @${preview.handle}`);
    setMode("idle");
    setPreview(null);
    setHandle("");
    refresh();
  }

  async function startVerify() {
    setBusy(true);
    const r = await doStart();
    setBusy(false);
    if ("error" in r && r.error) { toast.error(r.error); return; }
    if ("alreadyVerified" in r && r.alreadyVerified) { refresh(); return; }
    setCode(r.code ?? "");
    setMode("verify");
  }

  async function doVerifyNow() {
    setBusy(true);
    const r = await doVerify();
    setBusy(false);
    if ("error" in r && r.error) { toast.error(r.error); return; }
    toast.success("instagram verified ✓");
    setMode("idle");
    refresh();
  }
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}
