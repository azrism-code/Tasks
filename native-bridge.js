import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

window.MyTasksNative = {
  isNative: Capacitor.isNativePlatform(),
  LocalNotifications
};
