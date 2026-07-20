import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { deleteMyAccount } from "@/lib/profile.functions";
import { signOut } from "@/lib/store";
import { toast } from "sonner";

export function DeleteAccountButton() {
  const deleteFn = useServerFn(deleteMyAccount);
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (confirm.trim().toLowerCase() !== "delete") return;
    setBusy(true);
    try {
      const r = await deleteFn();
      if (!r.ok) {
        toast.error(r.error || "Couldn't delete account.");
        setBusy(false);
        return;
      }
      await signOut();
      toast("Your account has been deleted.");
      nav({ to: "/" });
    } catch {
      toast.error("Something went wrong.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full card-pop p-4 flex items-center gap-3 text-destructive tap-scale"
      >
        <Trash2 className="size-5" />
        <span className="font-bold">Delete account</span>
      </button>
    );
  }

  return (
    <div className="card-pop p-4 space-y-3 border-destructive/40">
      <div>
        <p className="font-bold text-destructive">Delete account?</p>
        <p className="text-xs text-muted-foreground mt-1">
          This permanently removes your profile, crushes, matches and messages. This cannot be undone.
        </p>
      </div>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder='Type "delete" to confirm'
        className="w-full bg-card border-2 border-destructive/40 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-destructive"
      />
      <div className="flex gap-2">
        <button
          onClick={() => { setOpen(false); setConfirm(""); }}
          disabled={busy}
          className="flex-1 rounded-full px-4 py-2.5 font-semibold bg-secondary tap-scale disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={busy || confirm.trim().toLowerCase() !== "delete"}
          className="flex-1 rounded-full px-4 py-2.5 font-semibold bg-destructive text-destructive-foreground tap-scale disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete forever"}
        </button>
      </div>
    </div>
  );
}
