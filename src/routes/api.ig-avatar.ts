import { createFileRoute } from "@tanstack/react-router";

// Proxy Instagram CDN avatar images. The IG CDN frequently blocks
// cross-origin <img> requests (hotlink protection / signed URL expiry),
// so we fetch server-side and stream the bytes back to the browser.
export const Route = createFileRoute("/api/ig-avatar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("u");
        if (!target) return new Response("missing u", { status: 400 });

        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          return new Response("bad url", { status: 400 });
        }
        // Only allow Instagram / Facebook CDN hosts.
        if (!/\.(fbcdn\.net|cdninstagram\.com)$/i.test(parsed.hostname)) {
          return new Response("forbidden host", { status: 403 });
        }

        const upstream = await fetch(parsed.toString(), {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            accept: "image/avif,image/webp,image/*,*/*;q=0.8",
            referer: "https://www.instagram.com/",
          },
        });

        if (!upstream.ok || !upstream.body) {
          return new Response("upstream error", { status: 502 });
        }

        return new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
            "cache-control": "public, max-age=86400, immutable",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
