import { readFile, writeFile } from "node:fs/promises";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
let manifest = await readFile(manifestPath, "utf8");
const permissions = [
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.VIBRATE"
];
for (const permission of permissions) {
  if (!manifest.includes(permission)) {
    manifest = manifest.replace(
      "<application",
      `<uses-permission android:name="${permission}" />\n\n    <application`
    );
  }
}
await writeFile(manifestPath, manifest);
