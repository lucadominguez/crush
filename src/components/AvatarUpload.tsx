import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { uploadAvatarFromFile, useMyProfile } from "@/lib/store";
import { toast } from "sonner";

export function AvatarUpload() {
  const { data: me, refresh } = useMyProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadAvatarFromFile(file);
      if (res.error) throw new Error(res.error);
      toast.success("Profile picture updated");
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const avatar = (me as any)?.avatar_url as string | undefined;

  return (
    <div className="card-pop p-4 flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative size-16 rounded-full bg-gradient-grape border-2 border-foreground flex items-center justify-center text-2xl font-black text-white overflow-hidden tap-scale"
        aria-label="Change profile picture"
      >
        {avatar ? (
          <img src={avatar} alt="Your profile" className="size-full object-cover" />
        ) : (
          <span>{me?.emoji ?? me?.name?.[0] ?? "?"}</span>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition">
          {uploading ? <Loader2 className="size-5 animate-spin text-white" /> : <Camera className="size-5 text-white" />}
        </div>
      </button>
      <div className="flex-1">
        <p className="font-bold">Profile picture</p>
        <p className="text-xs text-muted-foreground">Tap the photo to upload. PNG or JPG, up to 5MB.</p>
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
  );
}
