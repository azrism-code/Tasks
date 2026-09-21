const CACHE = "azri-tasks-v31";
const FILES = ["./", "./index.html", "./style.css?v=1.9.0-94112c0e", "./app.js?v=1.9.0-85aab4c1", "./manifest.webmanifest?v=1.9.0", "./icon.svg?v=1.9.0", "./header-logo.svg?v=1.9.0"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const sameOrigin = new URL(event.request.url).origin === location.origin;
  const networkRequest = sameOrigin ? new Request(event.request,{cache:"no-store"}) : event.request;
  event.respondWith(fetch(networkRequest).then(response => {
    if (response.ok && new URL(event.request.url).origin === location.origin) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
});
