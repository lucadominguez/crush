import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Lock, EyeOff, ShieldCheck, MessageSquareOff, UserX, Flag } from "lucide-react";
import { MobileShell, ScreenHeader } from "@/components/MobileShell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "privacy & safety · crush" },
      { name: "description", content: "how crush keeps your picks private and your community safe." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <MobileShell>
      <ScreenHeader
        title="privacy & safety"
        subtitle="the whole point of crush is privacy. here's how it works."
        back={
          <Link to="/app" className="size-9 -ml-1 rounded-full bg-secondary flex items-center justify-center tap-scale">
            <ArrowLeft className="size-4" />
          </Link>
        }
      />
      <div className="px-5 space-y-3 pb-10">
        <Card icon={Lock} title="your picks stay yours" text="no one ever sees who you chose. not your friends, and not the person you picked. names only surface when it's mutual." />
        <Card icon={EyeOff} title="no public profiles" text="you can't browse people on crush. no one can browse you." />
        <Card icon={MessageSquareOff} title="we never message anyone for you" text="no sms, email, or dm goes out on your behalf. invites are links you choose to share." />
        <Card icon={ShieldCheck} title="mutual-only reveal" text="if only one of you picks, nothing happens. both sides have to pick to unlock a match and a chat." />
        <Card icon={UserX} title="block anytime" text="blocking ends any match instantly and stops future ones." />
        <Card icon={Flag} title="report safely" text="one tap to report harassment, impersonation, or anything that feels off." />
      </div>
    </MobileShell>
  );
}

function Card({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="bg-card rounded-2xl p-4 shadow-card flex gap-3">
      <div className="size-10 rounded-xl bg-secondary flex items-center justify-center shrink-0">
        <Icon className="size-5 text-primary" />
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{text}</p>
      </div>
    </div>
  );
}
