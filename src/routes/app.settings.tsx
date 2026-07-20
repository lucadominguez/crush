import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Camera, Loader2, LogOut, Shield } from "lucide-react";
import { toast } from "sonner";
import { ScreenHeader } from "@/components/MobileShell";
import { InstagramClaimCard } from "@/components/InstagramClaimCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PushNotifToggle } from "@/components/PushNotifToggle";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { signOut, uploadAvatarFromFile, useMyProfile, useSession } from "@/lib/store";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "you · crush" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: me, refresh } = useMyProfile();
  const { session } = useSession();
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onLogout() { await signOut(); nav({ to: "/" }); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("pick an image"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("image must be under 5mb"); return; }
    setUploading(true);
    try {
      const res = await uploadAvatarFromFile(file);
      if (res.error) throw new Error(res.error);
      toast.success("profile pic updated");
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const avatar = (me as any)?.avatar_url as string | undefined;

  return (
    <>
      <ScreenHeader title="you" subtitle="your account and privacy." />
      <div className="px-5 space-y-3 pb-6">
        <div className="card-pop p-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="change profile picture"
            className="group relative size-16 shrink-0 rounded-full bg-gradient-grape border-2 border-foreground flex items-center justify-center text-2xl font-black text-white overflow-hidden tap-scale"
          >
            {avatar ? (
              <img src={avatar} alt="Your profile" className="size-full object-cover" />
            ) : (
              <span>{me?.emoji ?? me?.name?.[0] ?? "?"}</span>
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
              {uploading ? <Loader2 className="size-5 animate-spin text-white" /> : <Camera className="size-5 text-white" />}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 size-6 rounded-full bg-primary border-2 border-foreground flex items-center justify-center">
              {uploading ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
            </span>
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-black text-lg leading-tight truncate">{me?.name}</p>
            <p className="text-xs text-muted-foreground truncate">@{me?.handle} · {session?.user.email}</p>
            <p className="text-[11px] text-muted-foreground mt-1">tap photo to change · png/jpg, up to 5mb</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFile}
            disabled={uploading}
          />
        </div>

        <InstagramClaimCard />

        <ThemeToggle />

        <PushNotifToggle />

        <Link to="/privacy" className="card-pop p-4 flex items-center gap-3">
          <Shield className="size-5" />
          <div className="flex-1">
            <p className="font-bold">privacy</p>
            <p className="text-xs text-muted-foreground">how we keep your picks hidden</p>
          </div>
        </Link>

        <button onClick={onLogout} className="w-full card-pop p-4 flex items-center gap-3 text-destructive tap-scale">
          <LogOut className="size-5" />
          <span className="font-bold">log out</span>
        </button>

        <DeleteAccountButton />
      </div>
    </>
  );
}


