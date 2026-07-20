import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IGSearchResult = {
  handle: string;
  name: string;
  avatar: string | null;
  verified: boolean;
  isPrivate: boolean;
};

export type IGProfile = {
  handle: string;
  name: string;
  avatar: string | null;
  verified: boolean;
  isPrivate: boolean;
  followers: number;
  biography: string;
};

const HIKER = "https://api.hikerapi.com";

function proxyAvatar(url?: string | null): string | null {
  return url ? `/api/ig-avatar?u=${encodeURIComponent(url)}` : null;
}

async function hikerGet(path: string): Promise<unknown> {
  const key = process.env.HIKER_API_KEY;
  if (!key) throw new Error("HIKER_API_KEY is not configured");
  const res = await fetch(`${HIKER}${path}`, {
    headers: { accept: "application/json", "x-access-key": key },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HikerAPI ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export const searchInstagramUsers = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z.object({ query: z.string().min(1).max(64) }).parse(input)
  )
  .handler(async ({ data }) => {
    const q = data.query.trim().replace(/^@/, "");
    const json = (await hikerGet(`/v1/search/users?query=${encodeURIComponent(q)}`)) as Array<{
      username: string;
      full_name?: string;
      profile_pic_url?: string;
      is_verified?: boolean | null;
      is_private?: boolean | null;
    }>;

    const results: IGSearchResult[] = (Array.isArray(json) ? json : [])
      .filter((u) => u && typeof u.username === "string")
      .slice(0, 20)
      .map((u) => ({
        handle: u.username.toLowerCase(),
        name: u.full_name || u.username,
        avatar: proxyAvatar(u.profile_pic_url),
        verified: !!u.is_verified,
        isPrivate: !!u.is_private,
      }));

    return { results };
  });

// Fetch a single IG profile by username (for "is this you?" preview + verification)
export const getInstagramProfile = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z.object({ handle: z.string().min(1).max(64) }).parse(input)
  )
  .handler(async ({ data }) => {
    const h = data.handle.trim().replace(/^@/, "").toLowerCase();
    const json = (await hikerGet(`/v1/user/by/username?username=${encodeURIComponent(h)}`)) as {
      username?: string;
      full_name?: string;
      profile_pic_url?: string;
      is_verified?: boolean | null;
      is_private?: boolean | null;
      follower_count?: number;
      biography?: string;
    } | null;

    if (!json || !json.username) {
      return { profile: null as IGProfile | null };
    }
    const profile: IGProfile = {
      handle: json.username.toLowerCase(),
      name: json.full_name || json.username,
      avatar: proxyAvatar(json.profile_pic_url),
      verified: !!json.is_verified,
      isPrivate: !!json.is_private,
      followers: typeof json.follower_count === "number" ? json.follower_count : 0,
      biography: json.biography || "",
    };
    return { profile };
  });
