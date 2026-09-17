const CACHE = "azri-tasks-v20";
const FILES = ["./", "./index.html", "./style.css?v=1.6.5-2c5e96e2", "./app.js?v=1.6.5-0c95a5a4", "./manifest.webmanifest", "./icon.svg"];
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
