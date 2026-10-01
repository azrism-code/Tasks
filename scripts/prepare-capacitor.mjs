import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

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

await build({
  entryPoints: ["native-bridge.js"],
  outfile: "www/native-bridge.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true
});

const indexPath = "www/index.html";
let index = await readFile(indexPath, "utf8");
index = index.replace(
  '<script type="module" src="./app.js?v=2.4.3"></script>',
  '<script type="module" src="./native-bridge.js"></script>\n  <script type="module" src="./app.js?v=2.4.3"></script>'
);
await writeFile(indexPath, index);
