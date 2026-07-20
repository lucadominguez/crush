import { Heart, Lock } from "lucide-react";

/**
 * Pre-signup teaser shown after a user picks at least one crush on the landing page.
 * Shows a faked, blurred "match reveal" preview to communicate the dopamine of the
 * mutual-match moment without exposing any real data.
 */
export function BlurredRevealTeaser({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="relative mt-4 rounded-3xl border-2 border-foreground bg-gradient-bubble shadow-pop overflow-hidden">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-foreground text-background text-[11px] font-black">
            <Lock className="size-3" /> locked · sign up to reveal
          </span>
          <span className="text-[11px] font-bold text-muted-foreground">preview</span>
        </div>

        <div className="mt-3 flex items-center gap-3 select-none">
          <div className="size-14 rounded-full bg-card border-2 border-foreground flex items-center justify-center text-2xl blur-sm">
            👀
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-lg blur-sm">someone_you_know</p>
            <p className="text-xs font-bold blur-sm">picked you back · just now</p>
          </div>
          <div className="size-10 rounded-full bg-primary border-2 border-foreground flex items-center justify-center">
            <Heart className="size-5" fill="currentColor" />
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          <div className="h-3 rounded-full bg-card border-2 border-foreground blur-[2px]" />
          <div className="h-3 w-2/3 rounded-full bg-card border-2 border-foreground blur-[2px]" />
        </div>

        <p className="mt-3 text-xs font-bold text-center">
          {count === 1 ? "1 person" : `${count} people`} might already be picking you back.
        </p>
      </div>
    </div>
  );
}
