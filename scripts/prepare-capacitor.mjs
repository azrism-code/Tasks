import { cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html",
  "app.js",
  "style.css",
  "reminders.js",
  "firebase-config.js",
  "manifest.webmanifest",
  "service-worker.js",
  "icon.svg",
  "header-logo.svg"
];

await rm("www", { recursive: true, force: true });
await mkdir("www", { recursive: true });
for (const file of files) await cp(file, `www/${file}`);
