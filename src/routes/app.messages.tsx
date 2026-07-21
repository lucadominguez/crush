import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MessageCircle, Users, Plus, AlertCircle, RotateCw } from "lucide-react";
import { ScreenHeader } from "@/components/MobileShell";
import {
  useMyMatches,
  useLatestMatchPreviews,
  useConversationReads,
  useSession,
  type Match,
  type LatestPreview,
} from "@/lib/store";
import { useMyGroups, useLatestGroupPreviews, type Group, type GroupPreview } from "@/lib/groups";
import { CreateGroupSheet } from "@/components/CreateGroupSheet";

export const Route = createFileRoute("/app/messages")({
  head: () => ({ meta: [{ title: "Messages · Crush" }] }),
  component: MessagesPage,
});


const GIF_PREFIX = "[gif]";

function isGif(text: string) {
  return text.startsWith(GIF_PREFIX);
}

function previewText(text: string) {
  if (isGif(text)) return "GIF";
  return text;
}

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function avatarFor(m: Match) {
  if (m.other?.instagram_avatar) {
    return `/api/ig-avatar?u=${encodeURIComponent(m.other.instagram_avatar)}`;
  }
  const seed = encodeURIComponent(m.other?.handle ?? m.other?.name ?? m.id);
  return `https://api.dicebear.com/9.x/big-smile/svg?seed=${seed}`;
}

function MessagesPage() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const { data: matches, loading: matchesLoading, error: matchesError, refresh: refreshMatches } = useMyMatches();
  const { data: groups, loading: groupsLoading, error: groupsError, refresh: refreshGroups } = useMyGroups();
  const matchIds = useMemo(() => matches.map((m) => m.id), [matches]);
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const {
    previews: matchPreviews,
    loading: matchPreviewsLoading,
    error: matchPreviewsError,
    refresh: refreshMatchPreviews,
  } = useLatestMatchPreviews(matchIds);
  const {
    previews: groupPreviews,
    loading: groupPreviewsLoading,
    error: groupPreviewsError,
    refresh: refreshGroupPreviews,
  } = useLatestGroupPreviews(groupIds);
  const { reads } = useConversationReads();
  const [showCreate, setShowCreate] = useState(false);

  const loading = matchesLoading || groupsLoading;
  const listError = matchesError ?? groupsError;
  const previewsError = matchPreviewsError ?? groupPreviewsError;
  // Truthful classification: we can only call a match "fresh" once previews
  // have loaded successfully. During loading or after an error, hide the
  // "Say hi" strip so we never fabricate an unread/fresh state.
  const previewsReady = !matchPreviewsLoading && !matchPreviewsError;

  const withPreview = matches
    .map((m) => ({ m, p: matchPreviews[m.id] as LatestPreview | undefined }))
    .filter((x) => !!x.p)
    .sort((a, b) => new Date(b.p!.created_at).getTime() - new Date(a.p!.created_at).getTime());
  const freshMatches = previewsReady
    ? matches
        .filter((m) => !matchPreviews[m.id])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : [];

  const groupList = groups
    .map((g) => ({ g, p: groupPreviews[g.id] as GroupPreview | undefined }))
    .sort((a, b) => {
      const ta = new Date(a.p?.created_at ?? a.g.last_message_at ?? a.g.created_at).getTime();
      const tb = new Date(b.p?.created_at ?? b.g.last_message_at ?? b.g.created_at).getTime();
      return tb - ta;
    });

  const total = withPreview.length + groupList.length + freshMatches.length;
  const isEmpty = !loading && !listError && matches.length === 0 && groups.length === 0;

  function retryAll() {
    if (matchesError) refreshMatches();
    if (groupsError) refreshGroups();
    if (matchPreviewsError) refreshMatchPreviews();
    if (groupPreviewsError) refreshGroupPreviews();
  }


  return (
    <>
      <ScreenHeader
        title="Messages"
        subtitle={isEmpty ? "Chats unlock the moment you match." : loading ? "Loading…" : `${total} conversation${total === 1 ? "" : "s"}`}
        right={
          <button
            onClick={() => setShowCreate(true)}
            className="icon-btn"
            aria-label="Create group"
          >
            <Plus className="size-4" />
          </button>
        }
      />

      <div className="px-5 pb-28 space-y-6">
        {(listError || previewsError) && (
          <div className="surface p-4 flex items-start gap-3">
            <AlertCircle className="size-4 mt-0.5 text-destructive shrink-0" />
            <div className="flex-1 text-label">
              <p className="font-semibold">
                {listError ? "Couldn't load conversations" : "Couldn't load previews"}
              </p>
              <p className="text-muted-foreground">Check your connection and try again.</p>
            </div>
            <button
              onClick={retryAll}
              className="min-h-11 px-3 rounded-lg text-label font-semibold border border-border tap-scale"
            >
              <RotateCw className="size-4 inline mr-1" /> Retry
            </button>
          </div>
        )}


        {loading && !listError && <ListSkeleton />}

        {freshMatches.length > 0 && (
          <section aria-label="New matches">
            <SectionLabel>Say hi</SectionLabel>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {freshMatches.map((m) => (
                <Link
                  key={m.id}
                  to="/app/chat/$id"
                  params={{ id: m.id }}
                  className="flex flex-col items-center gap-1.5 shrink-0 w-16 tap-scale min-h-11"
                >
                  <div className="size-14 rounded-full overflow-hidden grid place-items-center relative" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                    <img src={avatarFor(m)} alt={m.other?.name ?? "match"} className="size-full object-cover" referrerPolicy="no-referrer" />
                    <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-primary border-2" style={{ borderColor: "var(--card)" }} aria-hidden />
                  </div>
                  <p className="text-micro font-medium truncate w-full text-center">{m.other?.name?.split(" ")[0] ?? "match"}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {groupList.length > 0 && (
          <section aria-label="Groups">
            <SectionLabel>Groups</SectionLabel>
            <ul className="stagger-tight rounded-2xl overflow-hidden bg-card/70 backdrop-blur border border-border/60 divide-y divide-border/60">
              {groupList.map(({ g, p }) => <GroupRow key={g.id} g={g} preview={p} uid={uid} readAt={reads[`group:${g.id}`] ?? 0} />)}
            </ul>
          </section>
        )}

        {withPreview.length > 0 && (
          <section aria-label="Direct messages">
            <SectionLabel>Direct</SectionLabel>
            <ul className="stagger-tight rounded-2xl overflow-hidden bg-card/70 backdrop-blur border border-border/60 divide-y divide-border/60">
              {withPreview.map(({ m, p }) => <DMRow key={m.id} m={m} preview={p!} uid={uid} readAt={reads[`match:${m.id}`] ?? 0} />)}
            </ul>
          </section>
        )}

        {isEmpty && (
          <div className="surface p-8 text-center">
            <div className="size-11 mx-auto rounded-full grid place-items-center" style={{ background: "color-mix(in oklab, var(--primary) 10%, var(--card))", color: "var(--primary)" }}>
              <MessageCircle className="size-5" />
            </div>
            <p className="mt-3 font-semibold text-lead">No chats yet</p>
            <p className="mt-1 text-label text-muted-foreground max-w-xs mx-auto">
              When two people pick each other, a private chat appears here.
            </p>
            <Link
              to="/app"
              className="mt-5 inline-flex px-5 py-2.5 min-h-11 rounded-lg text-body font-semibold tap-scale"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              Add a pick
            </Link>
          </div>
        )}
      </div>

      {showCreate && <CreateGroupSheet onClose={() => setShowCreate(false)} />}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="surface px-3 py-2.5 flex items-center gap-3">
          <div className="skeleton size-11 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3" style={{ width: "40%" }} />
            <div className="skeleton h-3" style={{ width: "70%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">{children}</p>;
}

function DMRow({ m, preview, uid, readAt }: { m: Match; preview: LatestPreview; uid: string | null; readAt: number }) {
  const ago = timeAgo(preview.created_at);
  const previewTs = new Date(preview.created_at).getTime();
  const unread = uid && preview.from_user_id !== uid && previewTs > readAt;

  const mine = preview.from_user_id === uid;
  return (
    <li>
      <Link to="/app/chat/$id" params={{ id: m.id }} className="px-3 py-3 min-h-14 flex items-center gap-3 tap-scale hover:bg-secondary/40 transition-colors">
        <div className="size-14 rounded-full overflow-hidden shrink-0 ring-1 ring-border/60" style={{ background: "var(--muted)" }}>
          <img src={avatarFor(m)} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-lead truncate ${unread ? "font-bold" : "font-semibold"}`}>{m.other?.name ?? "match"}</p>
            {ago && <span className={`text-micro shrink-0 ${unread ? "font-bold text-foreground" : "text-muted-foreground"}`}>{ago}</span>}
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className={`text-label truncate ${unread ? "text-foreground" : "text-muted-foreground"}`}>
              {mine && <span className="opacity-70">You: </span>}
              {previewText(preview.text)}
            </p>
            {unread && (
              <span className="ml-2 size-2.5 rounded-full shrink-0" style={{ background: "var(--primary)" }} aria-label="Unread" />
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function GroupRow({ g, preview, uid, readAt }: { g: Group; preview?: GroupPreview; uid: string | null; readAt: number }) {
  const activityIso = preview?.created_at ?? g.last_message_at ?? g.created_at;
  const ago = timeAgo(activityIso);
  const previewTs = preview ? new Date(preview.created_at).getTime() : 0;
  const unread = uid && preview && preview.from_user_id !== uid && previewTs > readAt;

  const mine = preview?.from_user_id === uid;
  return (
    <li>
      <Link to="/app/group/$id" params={{ id: g.id }} className="px-3 py-3 min-h-14 flex items-center gap-3 tap-scale hover:bg-secondary/40 transition-colors">
        <div className="size-14 rounded-2xl grid place-items-center text-2xl shrink-0 ring-1 ring-border/60" style={{ background: "color-mix(in oklab, var(--accent) 30%, var(--card))" }}>
          {g.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-lead truncate ${unread ? "font-bold" : "font-semibold"}`}>{g.name}</p>
            {ago && <span className={`text-micro shrink-0 ${unread ? "font-bold text-foreground" : "text-muted-foreground"}`}>{ago}</span>}
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className={`text-label truncate flex items-center gap-1 ${unread ? "text-foreground" : "text-muted-foreground"}`}>
              <Users className="size-3 shrink-0" strokeWidth={2.2} />
              {preview
                ? <>{mine && <span className="opacity-70">You: </span>}{previewText(preview.text)}</>
                : <span>Say hi to kick it off</span>}
            </p>
            {unread && (
              <span className="ml-2 size-2.5 rounded-full shrink-0" style={{ background: "var(--primary)" }} aria-label="Unread" />
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
