const CACHE = "azri-tasks-v49";
const PREFERENCES_CACHE="my-tasks-notification-preferences";
const PREFERENCES_URL=new URL("./notification-preferences",self.location).href;
self.addEventListener("message",event=>{
  if(event.data?.type==="notification-preferences")event.waitUntil(caches.open(PREFERENCES_CACHE).then(cache=>cache.put(PREFERENCES_URL,new Response(JSON.stringify(event.data.preferences)))));
});
const FILES = [
  "./",
  "./index.html",
  "./style.css?v=2.5.4",
  "./app.js?v=2.5.4",
  "./data-store.js?v=2.5.4",
  "./reminders.js?v=2.5.4",
  "./firebase-config.js?v=2.5.4",
  "./manifest.webmanifest?v=2.5.4",
  "./icon.svg?v=2.5.4",
  "./header-logo.svg?v=2.5.4"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== PREFERENCES_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url))))
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then(response => {
        if (response && response.status === 200 && (response.type === "basic" || (response.type === "cors" && new URL(event.request.url).origin === "https://www.gstatic.com"))) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match("./index.html")))
  );
});

self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const taskId = data.taskId || data.data?.taskId || "";
  const categoryId = data.categoryId || data.data?.categoryId || "";
  const subcategoryId = data.subcategoryId || data.data?.subcategoryId || "";
  const level = data.notificationLevel || data.data?.notificationLevel || "normal";
  const title = data.title || "My Tasks";
  const body = data.body || "יש לך תזכורת למשימה";
  const tag = data.tag || `task-reminder-${taskId || "general"}`;

  event.waitUntil(
    (async()=>{
    const stored=await caches.match(PREFERENCES_URL);
    const preferences=stored?await stored.json():{};
    if(preferences.enabled===false)return;
    return self.registration.showNotification(title, {
      body,
      icon: "./icon.svg",
      badge: "./icon.svg",
      tag,
      renotify: level !== "normal",
      requireInteraction: level === "important" || level === "critical",
      vibrate: level === "normal" ? [160] : [250, 120, 250],
      data: { taskId, categoryId, subcategoryId, notificationLevel: level },
      actions: [
        { action: "done", title: "✅ בוצע" },
        { action: "snooze10", title: "⏰ דחה 10 דקות" },
        { action: "snooze60", title: "⏰ דחה שעה" }
      ]
    });
    })()
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const params = new URLSearchParams();
  if (data.taskId) params.set("task", data.taskId);
  if (data.categoryId) params.set("category", data.categoryId);
  if (data.subcategoryId) params.set("subcategory", data.subcategoryId);
  if (event.action) params.set("notificationAction", event.action);
  const targetUrl = `./${params.toString() ? `?${params.toString()}` : ""}`;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })
  );
});
