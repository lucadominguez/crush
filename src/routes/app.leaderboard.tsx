import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IconFlame, IconGift, IconTrophy } from "@/components/icons/GlyphIcons";

import {
  getIndividualStandings,
  getSchoolStandings,
  type SchoolStanding,
  type StandingRow,
} from "@/lib/leaderboard.functions";

export const Route = createFileRoute("/app/leaderboard")({
  head: () => ({ meta: [{ title: "Standings · Crush" }] }),
  component: LeaderboardPage,
});

type Tab = "people" | "schools";
type Scope = "school" | "everyone";

function medal(rank: number): string | null {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
}

function LeaderboardPage() {
  const fetchPeople = useServerFn(getIndividualStandings);
  const fetchSchools = useServerFn(getSchoolStandings);

  const [tab, setTab] = useState<Tab>("people");
  const [scope, setScope] = useState<Scope>("everyone");
  const [people, setPeople] = useState<StandingRow[]>([]);
  const [me, setMe] = useState<StandingRow | null>(null);
  const [mySchool, setMySchool] = useState<string | null>(null);
  const [schools, setSchools] = useState<SchoolStanding[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "people") {
        const r = await fetchPeople({ data: { scope, limit: 25 } });
        setPeople(r.standings);
        setMe(r.me);
        setMySchool(r.school);
      } else {
        const r = await fetchSchools({ data: { limit: 20 } });
        setSchools(r.schools);
      }
    } catch {
      /* leave the empty state visible */
    } finally {
      setLoading(false);
    }
  }, [tab, scope, fetchPeople, fetchSchools]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-full px-5 pt-4 pb-28">
      <header className="mb-4">
        <h1 className="text-headline font-black lowercase">standings</h1>
        <p className="text-label text-muted-foreground">
          earned from poll wins, streaks and friends you brought in
        </p>
      </header>

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setTab("people")}
          aria-pressed={tab === "people"}
          className={tab === "people" ? "chip chip-primary min-h-11 px-4" : "chip min-h-11 px-4"}
        >
          people
        </button>
        <button
          onClick={() => setTab("schools")}
          aria-pressed={tab === "schools"}
          className={tab === "schools" ? "chip chip-primary min-h-11 px-4" : "chip min-h-11 px-4"}
        >
          schools
        </button>
      </div>

      {tab === "people" && mySchool && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setScope("everyone")}
            aria-pressed={scope === "everyone"}
            className={scope === "everyone" ? "chip chip-sun min-h-11 px-3" : "chip min-h-11 px-3"}
          >
            everyone
          </button>
          <button
            onClick={() => setScope("school")}
            aria-pressed={scope === "school"}
            className={scope === "school" ? "chip chip-sun min-h-11 px-3" : "chip min-h-11 px-3"}
          >
            {mySchool}
          </button>
        </div>
      )}

      {loading ? (
        // Skeletons keep the real row shape, so nothing jumps when data lands.
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="skeleton h-[66px] rounded-[20px]" />
          ))}
        </ul>
      ) : tab === "people" ? (
        people.length === 0 ? (
          <EmptyState text="nobody's on the board yet. vote in a poll or invite a friend to get on it." />
        ) : (
          <>
            {/* Keyed by scope so switching lens replays the cascade, which
                makes the list read as "re-ranked" rather than silently swapped. */}
            <ul className="space-y-2 stagger-tight" key={scope}>
              {people.map((p) => (
                <PersonRow key={p.user_id} p={p} highlight={p.user_id === me?.user_id} />
              ))}
            </ul>
            {me && me.rank > people.length && (
              <>
                <p className="text-center text-caption text-muted-foreground my-3">your spot</p>
                <PersonRow p={me} highlight />
              </>
            )}
          </>
        )
      ) : schools.length === 0 ? (
        <EmptyState text="no schools on the board yet. schools need at least 3 people." />
      ) : (
        <ul className="space-y-2 stagger-tight">
          {schools.map((s) => (
            <li key={s.school} className="surface p-3 flex items-center gap-3 lift">
              <span className="w-8 text-center font-black text-lead shrink-0 tabular-nums">
                {medal(s.rank) ?? s.rank}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lead truncate">{s.school}</p>
                <p className="text-caption text-muted-foreground">
                  {s.members} {s.members === 1 ? "person" : "people"}
                </p>
              </div>
              <span className="font-black text-lead text-gradient-primary shrink-0 tabular-nums">{s.score}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonRow({ p, highlight }: { p: StandingRow; highlight?: boolean }) {
  return (
    <li
      className={`surface p-3 flex items-center gap-3 lift ${highlight ? "shadow-glow" : ""}`}
      style={highlight ? { borderColor: "color-mix(in oklab, var(--primary) 45%, var(--border))" } : undefined}
    >
      <span className="w-8 text-center font-black text-lead shrink-0 tabular-nums">
        {medal(p.rank) ?? p.rank}
      </span>
      <div className="size-9 rounded-full bg-gradient-bubble grid place-items-center overflow-hidden shrink-0 text-lead">
        {p.avatar ? (
          <img
            src={`/api/ig-avatar?u=${encodeURIComponent(p.avatar)}`}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          (p.emoji ?? p.name?.[0] ?? "?")
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-body truncate">{p.name ?? "someone"}</p>
        <p className="text-micro text-muted-foreground truncate flex items-center gap-2">
          {p.poll_wins > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <IconTrophy size={13} />
              {p.poll_wins}
            </span>
          )}
          {p.streak > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <IconFlame size={13} />
              {p.streak}
            </span>
          )}
          {p.referrals > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <IconGift size={13} />
              {p.referrals}
            </span>
          )}
        </p>
      </div>
      <span className="font-black text-lead text-gradient-primary shrink-0 tabular-nums">{p.score}</span>
    </li>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="surface p-6 text-center">
      <p className="text-label text-muted-foreground">{text}</p>
    </div>
  );
}
