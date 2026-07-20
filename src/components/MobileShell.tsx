import { ReactNode } from "react";

/** App shell · warm candy gradient bg on mobile, comfy column on desktop. */
export function MobileShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh w-full flex justify-center hub-bg">
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-md md:max-w-lg"} min-h-dvh relative flex flex-col`}
      >
        {children}
      </div>
    </div>
  );
}

export function ScreenHeader({
  title, subtitle, right, back,
}: { title: string; subtitle?: string; right?: ReactNode; back?: ReactNode }) {
  return (
    <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2 min-w-0">
        {back}
        <div className="min-w-0">
          <h1 className="text-[24px] font-black tracking-tight truncate lowercase">{title}</h1>
          {subtitle && <p className="text-[13px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex items-center gap-1 shrink-0">{right}</div>}
    </div>
  );
}
