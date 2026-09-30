import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { GoogleSignIn } from "@capawesome/capacitor-google-sign-in";

const NotificationSettings = registerPlugin("NotificationSettings");

if (Capacitor.isNativePlatform()) document.documentElement.classList.add("native-app");

window.MyTasksNative = {
  isNative: Capacitor.isNativePlatform(),
  LocalNotifications,
  GoogleSignIn,
  NotificationSettings
};
