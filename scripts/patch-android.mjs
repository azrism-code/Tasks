import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

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

// Keep Capacitor WebView typography at the same 100% scale as the installed PWA.
const activityPath="android/app/src/main/java/com/azri/mytasks/MainActivity.java";
let activity=await readFile(activityPath,"utf8");
if(!activity.includes("setTextZoom(100)")){
  activity=activity.replace("import com.getcapacitor.BridgeActivity;","import android.os.Bundle;\n\nimport com.getcapacitor.BridgeActivity;");
  activity=activity.replace(
    "public class MainActivity extends BridgeActivity {}",
    "public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        bridge.getWebView().getSettings().setTextZoom(100);\n    }\n}"
  );
  await writeFile(activityPath,activity);
}

const iconSizes={mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192};
for(const density of Object.keys(iconSizes)){
  const target=`android/app/src/main/res/mipmap-${density}`;
  await mkdir(target,{recursive:true});
  await copyFile(`android-icons/ic_launcher-${density}.png`,`${target}/ic_launcher.png`);
  await copyFile(`android-icons/ic_launcher-${density}.png`,`${target}/ic_launcher_round.png`);
  await copyFile(`android-icons/ic_launcher_foreground-${density}.png`,`${target}/ic_launcher_foreground.png`);
}
