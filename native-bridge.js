import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { GoogleSignIn } from "@capawesome/capacitor-google-sign-in";

window.MyTasksNative = {
  isNative: Capacitor.isNativePlatform(),
  LocalNotifications,
  GoogleSignIn
};
