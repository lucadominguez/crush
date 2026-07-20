import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function getInitial(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("theme") as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const t = getInitial();
    setTheme(t);
    applyTheme(t);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try { window.localStorage.setItem("theme", next); } catch {}
  }

  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="card-pop p-4 flex items-center gap-3 w-full tap-scale"
    >
      {isDark ? <Moon className="size-5" /> : <Sun className="size-5" />}
      <div className="flex-1 text-left">
        <p className="font-bold">{isDark ? "Dark mode" : "Light mode"}</p>
        <p className="text-xs text-muted-foreground">Tap to switch · easier on the eyes at night</p>
      </div>
      <div className={`relative h-6 w-11 rounded-full transition-colors ${isDark ? "bg-accent" : "bg-muted"}`}>
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-card shadow transition-transform ${isDark ? "translate-x-5" : ""}`}
        />
      </div>
    </button>
  );
}
