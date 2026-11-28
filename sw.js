/* ذهب لايف — service worker: offline app shell. Prices are cached by the app in localStorage. */
const VERSION = "v5";
const CACHE = `gold-shell-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./config.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("gold-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin files: network first (so updates show up), cache as fallback.
// Cross-origin (the price API) is left to the page, which keeps its own copy.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      }),
  );
});

// Background alerts from the alerts server (Cloudflare Worker).
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: "ذهب لايف", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(d.title || "ذهب لايف", {
        body: d.body || "",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        lang: "ar",
        dir: "rtl",
        tag: d.tag || undefined,
        renotify: !!d.tag,
        data: { url: "./" },
      }),
      // let an open app refresh its alert list
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: "pushed" }))),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ("focus" in w) return w.focus();
      return self.clients.openWindow("./");
    }),
  );
});
