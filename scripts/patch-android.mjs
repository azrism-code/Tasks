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
if(!activity.includes("NotificationSettingsPlugin.class")){
  activity=activity.replace("super.onCreate(savedInstanceState);","registerPlugin(NotificationSettingsPlugin.class);\n        super.onCreate(savedInstanceState);");
  await writeFile(activityPath,activity);
}

const settingsPluginPath="android/app/src/main/java/com/azri/mytasks/NotificationSettingsPlugin.java";
await writeFile(settingsPluginPath,`package com.azri.mytasks;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "NotificationSettings")
public class NotificationSettingsPlugin extends Plugin {
    private Ringtone preview;
    private Uri soundUri(String sound) {
        if ("silent".equals(sound)) return null;
        if ("default".equals(sound)) return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        if (!java.util.Arrays.asList("gentle", "normal", "loud", "bell", "alarm").contains(sound))
            throw new IllegalArgumentException("Unknown notification sound");
        return Uri.parse("android.resource://" + getContext().getPackageName() + "/raw/tasks_" + sound);
    }

    @PluginMethod
    public void createReminderChannel(PluginCall call) {
        try {
            String id = call.getString("id");
            String sound = call.getString("sound", "default");
            String level = call.getString("level", "normal");
            int importance = "normal".equals(level) ? NotificationManager.IMPORTANCE_DEFAULT : NotificationManager.IMPORTANCE_HIGH;
            NotificationChannel channel = new NotificationChannel(id, "My Tasks · " + sound + " · " + level, importance);
            channel.setDescription("צליל ורטט שנבחרו בהגדרות My Tasks");
            channel.setSound(soundUri(sound), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            channel.enableVibration(call.getBoolean("vibration", true));
            ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
            call.resolve(new JSObject());
        } catch (Exception error) { call.reject("יצירת ערוץ ההתראה נכשלה", error); }
    }

    @PluginMethod
    public void previewSound(PluginCall call) {
        try {
            if (preview != null) preview.stop();
            Uri uri = soundUri(call.getString("sound", "default"));
            if (uri != null) {
                preview = RingtoneManager.getRingtone(getContext(), uri);
                if (preview == null) throw new IllegalStateException("Sound unavailable");
                preview.play();
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    if (preview != null) preview.stop();
                }, 4000);
            }
            call.resolve(new JSObject());
        } catch (Exception error) { call.reject("השמעת הצליל נכשלה", error); }
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        getActivity().startActivity(intent);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            .setData(Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve(new JSObject());
    }
}
`);

const iconSizes={mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192};
for(const density of Object.keys(iconSizes)){
  const target=`android/app/src/main/res/mipmap-${density}`;
  await mkdir(target,{recursive:true});
  await copyFile(`android-icons/ic_launcher-${density}.png`,`${target}/ic_launcher.png`);
  await copyFile(`android-icons/ic_launcher-${density}.png`,`${target}/ic_launcher_round.png`);
  await copyFile(`android-icons/ic_launcher_foreground-${density}.png`,`${target}/ic_launcher_foreground.png`);
}

// Package short PCM sounds as Android resources, using the same synthesis as preview assets.
await import("./generate-sounds.mjs");
const rawDirectory="android/app/src/main/res/raw";
await mkdir(rawDirectory,{recursive:true});
for(const sound of ["gentle","normal","loud","bell","alarm"])
  await copyFile(`sounds/tasks_${sound}.wav`,`${rawDirectory}/tasks_${sound}.wav`);
const gradlePath="android/app/build.gradle";
let gradle=await readFile(gradlePath,"utf8");
gradle=gradle.replace(/versionCode \d+/,"versionCode 20409").replace(/versionName "[^"]+"/,'versionName "2.4.9"');
await writeFile(gradlePath,gradle);
