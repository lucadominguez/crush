import { createFileRoute } from "@tanstack/react-router";

import { getAvatarsBucket } from "@/backend/bindings";

// Serve avatar images from the private R2 bucket. Keys look like
// `<user_id>/avatar-<ts>.<ext>` and are unguessable enough for avatars;
// the bucket itself is never public.
export const Route = createFileRoute("/api/avatar/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = (params as { _splat?: string })._splat ?? "";
        if (!key || key.includes("..")) return new Response("bad key", { status: 400 });
        const obj = await getAvatarsBucket().get(key);
        if (!obj) return new Response("not found", { status: 404 });
        return new Response(obj.body, {
          status: 200,
          headers: {
            "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
