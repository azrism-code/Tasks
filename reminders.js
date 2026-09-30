import { Timestamp, updateDoc, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export const reminderDefaults = {
  enabled: false, dateTime: null, nextTriggerAt: null, timeZone: null, repeat: "none", customRepeat: { interval: 1, unit: "day" },
  notificationLevel: "normal", snoozedUntil: null, lastTriggeredAt: null
};
const repeats = new Set(["none", "daily", "weekly", "monthly", "custom"]);
const levels = new Set(["normal", "important", "critical"]);
const units = new Set(["day", "week", "month"]);
const asDate = value => value?.toDate ? value.toDate() : value ? new Date(value) : null;
const validDate = value => value && !Number.isNaN(value.getTime());
const stamp = value => value ? Timestamp.fromDate(value) : null;

export function createReminder({enabled, date, time, repeat, interval, unit, level}) {
  if (!enabled) return {...reminderDefaults};
  const dateTime = new Date(`${date}T${time}`);
  if (!validDate(dateTime)) throw new Error("יש להזין תאריך ושעה לתזכורת");
  if (!repeats.has(repeat) || !levels.has(level) || !units.has(unit)) throw new Error("הגדרת תזכורת לא תקינה");
  const count = Number(interval);
  if (!Number.isInteger(count) || count < 1 || count > 365) throw new Error("מרווח חזרה לא תקין");
  return {enabled:true,dateTime:stamp(dateTime),nextTriggerAt:stamp(dateTime),
    timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,repeat,
    customRepeat:{interval:count,unit},notificationLevel:level,snoozedUntil:null,lastTriggeredAt:null};
}
export const updateReminder = (current, input) => {
  const next = createReminder(input);
  if (next.enabled && current?.enabled && +asDate(current.dateTime) === +asDate(next.dateTime)) {
    if(current.repeat===next.repeat && current.customRepeat?.interval===next.customRepeat.interval &&
      current.customRepeat?.unit===next.customRepeat.unit) {
      next.nextTriggerAt=current.nextTriggerAt||next.dateTime;
      next.snoozedUntil=current.snoozedUntil||null;
      next.lastTriggeredAt=current.lastTriggeredAt||null;
    }
  }
  return next;
};
export const deleteReminder = () => ({...reminderDefaults});

export function nextOccurrence(reminder, after) {
  const result = asDate(reminder.dateTime);
  if (!validDate(result) || reminder.repeat === "none") return null;
  const [interval, unit] = reminder.repeat === "custom"
    ? [reminder.customRepeat?.interval || 1, reminder.customRepeat?.unit || "day"]
    : [1, {daily:"day",weekly:"week",monthly:"month"}[reminder.repeat]];
  // Advance in local calendar time. Clamp months such as January 31 to February's last day.
  for (let i=0; i<5000 && result <= after; i++) {
    if (unit === "month") {
      const day=result.getDate(), hour=result.getHours(), minute=result.getMinutes();
      result.setDate(1); result.setMonth(result.getMonth()+interval);
      const last=new Date(result.getFullYear(),result.getMonth()+1,0).getDate();
      result.setDate(Math.min(day,last)); result.setHours(hour,minute,0,0);
    } else result.setDate(result.getDate()+interval*(unit === "week" ? 7 : 1));
  }
  return result > after ? result : null;
}

export function scheduleReminder(task) {
  if (!task || task.completedAt || task.archivedAt || !task.reminder?.enabled) return null;
  const reminder=task.reminder;
  const next=asDate(reminder.nextTriggerAt || reminder.snoozedUntil || reminder.dateTime);
  return validDate(next) ? next : null;
}

export function createReminderService({db, taskRef, getTasks, onError}) {
  let timer=null, busy=false, nativeInitialized=false;
  const nativePlugin=()=>window.MyTasksNative?.isNative ? window.MyTasksNative.LocalNotifications : null;
  const notificationId=id=>{
    let hash=0;
    for(const char of String(id))hash=((hash<<5)-hash+char.charCodeAt(0))|0;
    return hash===0?1:Math.abs(hash);
  };
  async function initNative() {
    const plugin=nativePlugin();
    if(!plugin || nativeInitialized)return plugin;
    nativeInitialized=true;
    await plugin.registerActionTypes({types:[{id:"TASK_REMINDER",actions:[
      {id:"done",title:"✅ בוצע"},
      {id:"snooze10",title:"⏰ דחה 10 דקות"},
      {id:"snooze60",title:"⏰ דחה שעה"}
    ]}]});
    for(const channel of [
      {id:"tasks-normal",name:"תזכורות רגילות",description:"תזכורות רגילות של My Tasks",importance:3,vibration:false},
      {id:"tasks-important",name:"תזכורות חשובות",description:"תזכורות חשובות עם צליל ורטט",importance:4,vibration:true},
      {id:"tasks-critical",name:"תזכורות קריטיות",description:"תזכורות דחופות של My Tasks",importance:5,vibration:true}
    ]) {
      try{await plugin.createChannel(channel);}catch(error){console.debug(error);}
    }
    await plugin.addListener("localNotificationActionPerformed",async event=>{
      try{
        const id=event.notification?.extra?.taskId;
        if(!id)return;
        if(event.actionId==="done")await markReminderCompleted(id);
        if(event.actionId==="snooze10")await snoozeReminder(id,10);
        if(event.actionId==="snooze60")await snoozeReminder(id,60);
        await syncNative();
      }catch(error){onError(error);}
    });
    return plugin;
  }
  async function permission() {
    const plugin=await initNative();
    if(plugin){
      let status=await plugin.checkPermissions();
      if(status.display!=="granted")status=await plugin.requestPermissions();
      if(status.display!=="granted")return false;
      try{
        const exact=await plugin.checkExactNotificationSetting();
        if(exact.exact_alarm!=="granted")await plugin.changeExactNotificationSetting();
      }catch(error){console.debug(error);}
      return true;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
    if (Notification.permission === "default") await Notification.requestPermission();
    return Notification.permission === "granted";
  }
  async function scheduleNativeTask(task) {
    const plugin=await initNative();
    if(!plugin)return false;
    const id=notificationId(task.id);
    await plugin.cancel({notifications:[{id}]});
    const due=scheduleReminder(task);
    if(!due)return true;
    const status=await plugin.checkPermissions();
    if(status.display!=="granted")return false;
    const at=due<=new Date()?new Date(Date.now()+1500):due;
    const level=task.reminder?.notificationLevel||"normal";
    const result=await plugin.schedule({notifications:[{
      id,title:task.text,body:"תזכורת מ־My Tasks",
      schedule:{at,allowWhileIdle:true},
      channelId:level==="critical"?"tasks-critical":level==="important"?"tasks-important":"tasks-normal",
      actionTypeId:"TASK_REMINDER",extra:{taskId:task.id},
      iconColor:"#2563EB",ongoing:level==="critical",autoCancel:level!=="critical",
      isExactNotification:true,isExactMandatory:false
    }]});
    if(result?.warning)console.warn(result.warning);
    return true;
  }
  async function syncNative() {
    const plugin=await initNative();
    if(!plugin)return false;
    const status=await plugin.checkPermissions();
    if(status.display!=="granted")return false;
    for(const task of getTasks())await scheduleNativeTask(task);
    return true;
  }
  async function show(task) {
    const plugin=nativePlugin();
    if(plugin)return scheduleNativeTask(task);
    if (Notification.permission !== "granted") return;
    const registration=await navigator.serviceWorker.ready;
    await registration.showNotification(task.text, {
      body:"תזכורת מ־My Tasks",
      icon:"./icon.svg",tag:`reminder-${task.id}`,
      renotify:true,requireInteraction:task.reminder.notificationLevel !== "normal",
      vibrate:task.reminder.notificationLevel === "normal" ? undefined : [250,150,250],
      data:{taskId:task.id},
      actions:[{action:"done",title:"✅ בוצע"},{action:"snooze10",title:"⏰ דחה 10 דקות"},{action:"snooze60",title:"⏰ דחה שעה"}]
    });
  }
  async function tick() {
    if(nativePlugin())return;
    if (busy || !("Notification" in window) || Notification.permission !== "granted") return; busy=true;
    try {
      for (const task of getTasks()) {
        const due=scheduleReminder(task);
        if (!due || due > new Date()) continue;
        const ref=taskRef(task.id);
        const claimed=await runTransaction(db,async tx=>{
          const doc=await tx.get(ref);
          if (!doc.exists()) return false;
          const fresh={id:task.id,...doc.data()}, current=scheduleReminder(fresh);
          if (!current || current > new Date()) return false;
          const last=asDate(fresh.reminder.lastTriggeredAt);
          if (last && last >= current) return false;
          const next=nextOccurrence(fresh.reminder,new Date());
          tx.update(ref,{"reminder.lastTriggeredAt":Timestamp.now(),
            "reminder.nextTriggerAt":stamp(next),"reminder.snoozedUntil":null,
            "reminder.enabled":!!next});
          return true;
        });
        if (claimed) await show(task);
      }
    } catch (error) {onError(error);} finally {busy=false;}
  }
  async function snoozeReminder(id,minutes){
    const when=new Date(Date.now()+minutes*60000);
    await updateDoc(taskRef(id),{
      "reminder.enabled":true,"reminder.nextTriggerAt":Timestamp.fromDate(when),
      "reminder.snoozedUntil":Timestamp.fromDate(when)
    });
    const task=getTasks().find(item=>item.id===id);
    if(task)await scheduleNativeTask({...task,reminder:{...task.reminder,enabled:true,nextTriggerAt:Timestamp.fromDate(when),snoozedUntil:Timestamp.fromDate(when)}});
  }
  async function markReminderCompleted(id){
    await updateDoc(taskRef(id),{completedAt:Timestamp.now(),archivedAt:null,
      "reminder.enabled":false,"reminder.snoozedUntil":null});
    const plugin=nativePlugin();
    if(plugin)await plugin.cancel({notifications:[{id:notificationId(id)}]});
  }
  return {
    permission,
    start() {
      this.stop();
      if(nativePlugin()){
        initNative().then(async plugin=>{
          const status=await plugin.checkPermissions();
          if(status.display==="granted")await syncNative();
        }).catch(onError);
      }else{
        timer=setInterval(tick,15000);tick();
      }
    },
    stop() {if(timer)clearInterval(timer);timer=null;},
    tick,syncNative,scheduleNativeTask,snoozeReminder,markReminderCompleted
  };
}
