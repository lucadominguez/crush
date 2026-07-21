// Push service worker.
//
// Kept deliberately minimal: it renders notifications and routes clicks. It
// does NOT cache app shell or intercept fetch, so it can never serve a stale
// build. Payloads carry titles/counts only, never message text or the identity
// of who picked someone.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "crush";
  const options = {
    body: data.body || "",
    tag: data.tag || "crush",
    // Replace rather than stack: several picks in a row should not become
    // several notifications.
    renotify: !!data.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/app" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/app";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open tab when there is one, so clicking a notification does
      // not pile up duplicate app windows.
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
