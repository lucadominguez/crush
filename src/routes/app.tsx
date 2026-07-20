import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { MobileShell } from "@/components/MobileShell";
import { BottomNav } from "@/components/BottomNav";
import { useSession } from "@/lib/store";

export const Route = createFileRoute("/app")({
  component: AppShell,
});

function AppShell() {
  const { session, loading } = useSession();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && !session) nav({ to: "/" });
  }, [loading, session, nav]);

  return (
    <MobileShell>
      <div className="flex-1 overflow-y-auto pb-2 relative">
        <Outlet />
      </div>
      <BottomNav />
    </MobileShell>
  );
}
