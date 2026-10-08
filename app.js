import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch, setStorageMode
} from "./data-store.js?v=2.5.0";
import { firebaseConfig, webPushPublicKey } from "./firebase-config.js?v=2.5.0";
import { createReminder, updateReminder, createReminderService, scheduleReminder } from "./reminders.js?v=2.5.0";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const text = {
  en: {
    tasks:"Tasks",history:"History",areas:"Areas",work:"Work",private:"Private",signout:"Sign out",addTask:"Add task",
    cancel:"Cancel",save:"Save",move:"Move",moveTask:"Move task",newTask:"New task",editTask:"Edit task",
    newList:"New list",editList:"Edit list",listName:"List name",taskPlaceholder:"What needs to be done?",
    taskCount:"tasks",empty:"Nothing here",emptyHint:"Add a task and keep it simple.",edit:"Edit",delete:"Delete",
    restore:"Restore",done:"Done",completed:"Completed",completeTitle:"Mark as done?",
    completeBody:"This task will move to History and receive today’s completion date.",
    deleteTitle:"Delete task?",deleteBody:"This cannot be undone.",restoreTitle:"Restore task?",
    restoreBody:"The task will return to the active list.",deleteListTitle:"Delete list?",
    deleteListBody:"Only an empty list can be deleted.",listNotEmpty:"Move or delete its tasks first.",
    saved:"Saved",error:"Something went wrong. Try again.",confirm:"Confirm"
  },
  he: {
    tasks:"משימות",history:"היסטוריה",areas:"תחומים",work:"עבודה",private:"פרטי",signout:"יציאה",addTask:"הוסף משימה",
    cancel:"ביטול",save:"שמירה",move:"העברה",moveTask:"העברת משימה",newTask:"משימה חדשה",editTask:"עריכת משימה",
    newList:"רשימה חדשה",editList:"עריכת רשימה",listName:"שם הרשימה",taskPlaceholder:"מה צריך לעשות?",
    taskCount:"משימות",empty:"אין כאן משימות",emptyHint:"הוסף משימה ושמור על זה פשוט.",edit:"עריכה",delete:"מחיקה",
    restore:"שחזור",done:"הושלם",completed:"הושלם",completeTitle:"לסמן כהושלם?",
    completeBody:"המשימה תסומן כהושלמה, יתווסף לה תאריך והיא תעבור לתחתית הרשימה.",
    deleteTitle:"למחוק את המשימה?",deleteBody:"לא ניתן לבטל פעולה זו.",restoreTitle:"לשחזר את המשימה?",
    restoreBody:"המשימה תחזור לרשימה הפעילה.",deleteListTitle:"למחוק את הרשימה?",
    deleteListBody:"אפשר למחוק רק רשימה ריקה.",listNotEmpty:"יש להעביר או למחוק קודם את המשימות שלה.",
    saved:"נשמר",error:"משהו השתבש. נסה שוב.",confirm:"אישור"
  }
};

const lastArea=["work","private"].includes(localStorage.getItem("tasks-last-area"))?localStorage.getItem("tasks-last-area"):"work";
const savedCategory = area => localStorage.getItem(`tasks-selected-${area}`) || "";
const notificationDefaults={enabled:true,sound:"default",vibration:true};
const soundChoices=["default","gentle","normal","loud","bell","alarm","silent"];
const defaultSettings={theme:"light",areaLanguages:{work:"en",private:"he"}};
function loadSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem("my-tasks-settings")||"{}");
    return {
      theme:["light","dark"].includes(saved.theme)?saved.theme:defaultSettings.theme,
      areaLanguages:{
        work:["he","en"].includes(saved.areaLanguages?.work)?saved.areaLanguages.work:defaultSettings.areaLanguages.work,
        private:["he","en"].includes(saved.areaLanguages?.private)?saved.areaLanguages.private:defaultSettings.areaLanguages.private
      }
    };
  }catch{return structuredClone(defaultSettings);}
}
const todayKey=new Date().toISOString().slice(0,10);
const state = { storageMode:localStorage.getItem("my-tasks-storage-mode")==="local"?"local":"cloud", user:null, language:"he", settings:loadSettings(), notifications:{...notificationDefaults}, notificationStatus:null, area:lastArea, view:"tasks", selected:savedCategory(lastArea), categories:[], tasks:[], tasksLoaded:false, editingTask:null, editingCategory:null, movingTask:null, confirmAction:null, reopenCategoryManager:false, unsubs:[], dragging:false, categoriesExpanded:false, suppressCategoryClick:false, calendarMonth:new Date(new Date().getFullYear(),new Date().getMonth(),1), selectedCalendarDate:todayKey };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const t = key => text[state.language][key] || key;
const isHebrew = value => /[\u0590-\u05FF]/.test(value);
const contentLanguage = area => state.settings.areaLanguages[area||state.area];
const contentDirection = area => contentLanguage(area)==="he"?"rtl":"ltr";
function applySettings(){document.documentElement.dataset.theme=state.settings.theme;document.documentElement.style.colorScheme=state.settings.theme;}
const isArchived = task => !!task.archivedAt || (!!task.completedAt && task.archivedAt===undefined);
const userCollection = name => collection(db,"users",state.user.uid,name);
const userDoc = (name,id) => doc(db,"users",state.user.uid,name,id);
const reminderService=createReminderService({db,taskRef:id=>userDoc("tasks",id),getTasks:()=>state.tasks,getPreferences:()=>state.notifications,onError:console.error});
async function refreshNotificationStatus(renderAfter=false){
  try{state.notificationStatus=await reminderService.status();}
  catch(error){console.error(error);state.notificationStatus={native:!!window.MyTasksNative?.isNative,display:"error",exact:"unknown",pending:0};}
  updateNotificationSettingsUi();
  if(renderAfter)render();
  return state.notificationStatus;
}
async function offerInitialNotificationPermission(){
  const status=await refreshNotificationStatus(true);
  const key="my-tasks-notification-intro-v1";
  if(!state.notifications.enabled||status.display==="granted"||localStorage.getItem(key))return;
  localStorage.setItem(key,"shown");
  setTimeout(async()=>{
    const question=state.storageMode==="local"&&!window.MyTasksNative?.isNative?"לאפשר התראות לתזכורות מקומיות כשהאפליקציה פתוחה?":"כדי לקבל תזכורות גם כשהאפליקציה סגורה, יש לאפשר ל־My Tasks לשלוח התראות. לאפשר עכשיו?";
    if(!confirm(question))return;
    await requestNotificationPermission();
  },250);
}
function notificationStatusLabel(status=state.notificationStatus){
  if(!state.notifications.enabled)return "התראות כבויות במכשיר זה";
  if(!status)return "בודק הרשאות…";
  if(status.display==="error")return "⚠️ לא ניתן לקרוא את מצב ההרשאה — ניתן לפתוח את הגדרות Android";
  if(status.display!=="granted")return "⛔ ההתראות חסומות";
  if(status.native&&status.exact!=="granted")return "⚠️ התראות פעילות, תזמון מדויק אינו מאושר";
  return status.native?`✅ פעיל · ${status.pending} תזכורות מתוזמנות`:"✅ התראות הדפדפן פעילות";
}
function updateNotificationSettingsUi(){
  const label=$("#notificationStatus");if(!label)return;
  const status=state.notificationStatus;
  const native=!!window.MyTasksNative?.isNative;
  $("#nativeSoundSettings").classList.toggle("hidden",!native);
  $("#pwaSoundHelp").classList.toggle("hidden",native);
  $("#notificationHelp").textContent=state.storageMode==="local"&&!native?"במצב מקומי תזכורות PWA פועלות כשהאפליקציה פתוחה. ב־APK הן מתוזמנות גם כשהוא סגור.":"בדיקת ההתראה תופיע בתוך כחמש שניות.";
  $("#notificationSource").textContent=native?"מקור ההתראה: APK · ההגדרה חלה על התקנה זו":"מקור ההתראה: PWA · ההגדרה חלה על דפדפן זה";
  label.textContent=notificationStatusLabel(status);
  label.className=`notification-status ${status?.display==="granted"?(status.native&&status.exact!=="granted"?"warning":"success"):status?.display==="error"?"warning":"blocked"}`;
  $("#openNotificationSettingsBtn").classList.toggle("hidden",!status?.native);
  $("#openExactAlarmSettingsBtn").classList.toggle("hidden",!status?.native||status.exact==="granted");
  $("#requestNotificationPermissionBtn").classList.toggle("hidden",status?.display==="granted");
}
async function registerPushSubscription() {
  if(state.storageMode!=="cloud" || window.MyTasksNative?.isNative || !state.notifications.enabled || !webPushPublicKey || !("Notification" in window) || Notification.permission!=="granted" || !("PushManager" in window))return;
  const registration=await navigator.serviceWorker.ready;
  const bytes=Uint8Array.from(atob(webPushPublicKey.replace(/-/g,"+").replace(/_/g,"/")),char=>char.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription() ||
    await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
  const endpointId=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(subscription.endpoint))
    .then(buffer=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,"0")).join(""));
  await setDoc(userDoc("pushSubscriptions",endpointId),{subscription:subscription.toJSON(),updatedAt:serverTimestamp()});
}
async function unregisterPushSubscription(){
  if(window.MyTasksNative?.isNative || !("serviceWorker" in navigator))return;
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager?.getSubscription();
  if(!subscription)return;
  const endpointId=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(subscription.endpoint)).then(buffer=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,"0")).join(""));
  await subscription.unsubscribe();
  if(state.user&&state.storageMode==="cloud")await deleteDoc(userDoc("pushSubscriptions",endpointId));
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));

function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2200); }
function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date ? new Intl.DateTimeFormat(state.language==="he"?"he-IL":"en-GB",{day:"numeric",month:"short",year:"numeric"}).format(date) : "";
}
async function safe(action) { try { await action(); } catch (error) { console.error(error); toast(t("error")); } }

let voiceRecognition=null;
let voiceListening=false;
let voiceSupported=true;

function setVoiceButton(listening){
  const button=$("#voiceTaskBtn");
  button.classList.toggle("listening",listening);
  button.innerHTML=listening?"⏹️ <span>עצור הקלטה</span>":"🎙️ <span>הקלט</span>";
}

function initVoiceInput(){
  const button=$("#voiceTaskBtn");
  const status=$("#voiceStatus");
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    voiceSupported=false;
    button.disabled=false;
    button.onclick=()=>{
      $("#taskText").focus();
      status.textContent="הדפדפן הזה אינו תומך בזיהוי דיבור. פתח ב-Chrome או השתמש במיקרופון שבמקלדת.";
      toast("זיהוי דיבור אינו נתמך בדפדפן הזה");
    };
    status.textContent="להכתבה קולית יש לפתוח את האפליקציה ב-Chrome";
    return;
  }
  voiceRecognition=new SpeechRecognition();
  voiceRecognition.continuous=false;
  voiceRecognition.interimResults=true;
  voiceRecognition.maxAlternatives=1;
  let baseText="";
  button.onclick=()=>{
    if(voiceListening){voiceRecognition.stop();return;}
    const input=$("#taskText");
    baseText=input.value.trim();
    const language=contentLanguage();
    voiceRecognition.lang=language==="he"?"he-IL":"en-US";
    status.textContent=language==="he"?"מקשיב בעברית…":"Listening in English…";
    try{voiceRecognition.start();}catch(error){console.error(error);status.textContent="לא ניתן להתחיל הקלטה. נסה שוב.";}
  };
  voiceRecognition.onstart=()=>{voiceListening=true;setVoiceButton(true);};
  voiceRecognition.onresult=event=>{
    let transcript="";
    for(let index=0;index<event.results.length;index++)transcript+=event.results[index][0].transcript;
    const input=$("#taskText");
    input.value=[baseText,transcript.trim()].filter(Boolean).join(" ");
    input.dir=contentDirection();
  };
  voiceRecognition.onerror=event=>{
    console.error(event.error);
    const messages={"not-allowed":"יש לאשר הרשאת מיקרופון בהגדרות האתר","no-speech":"לא זוהה דיבור. לחץ ונסה שוב.","audio-capture":"לא נמצא מיקרופון זמין","network":"שגיאת רשת בזיהוי הדיבור"};
    status.textContent=messages[event.error]||"לא הצלחתי לזהות את הדיבור";
  };
  voiceRecognition.onend=()=>{
    voiceListening=false;setVoiceButton(false);
    if(!status.textContent.includes("לא")&&!status.textContent.includes("שגיאת"))status.textContent="ההקלטה הסתיימה — ניתן לערוך ולשמור";
    $("#taskText").focus();
  };
}

function resetVoiceInput(){
  if(voiceListening&&voiceRecognition)voiceRecognition.stop();
  setVoiceButton(false);
  $("#voiceStatus").textContent=voiceSupported?(contentLanguage()==="he"?"זיהוי דיבור בעברית":"Speech recognition in English"):"להכתבה קולית יש לפתוח את האפליקציה ב-Chrome";
}

async function login() {
  state.storageMode="cloud";setStorageMode("cloud");localStorage.setItem("my-tasks-storage-mode","cloud");
  if(auth.currentUser){await activateSession(auth.currentUser,"cloud");return;}
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  try {
    if(window.MyTasksNative?.isNative){
      await window.MyTasksNative.GoogleSignIn.initialize({clientId:"707546310998-bks8tbq89lgu4o8vkgep4grmmvi1d7b0.apps.googleusercontent.com"});
      const result=await window.MyTasksNative.GoogleSignIn.signIn();
      await signInWithCredential(auth,GoogleAuthProvider.credential(result.idToken));
      return;
    }
    await signInWithPopup(auth,provider);
  }
  catch (error) {
    if (!window.MyTasksNative?.isNative && ["auth/popup-blocked","auth/popup-closed-by-user","auth/cancelled-popup-request"].includes(error.code)) await signInWithRedirect(auth,provider);
    else { console.error(error); toast(t("error")); }
  }
}

function startSync() {
  state.tasksLoaded=false;
  state.unsubs.forEach(unsub=>unsub()); state.unsubs=[];
  state.unsubs.push(onSnapshot(userCollection("categories"), snapshot => {
    state.categories=snapshot.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    if (!state.categories.some(c=>c.id===state.selected&&c.area===state.area)) state.selected=state.categories.find(c=>c.id===savedCategory(state.area)&&c.area===state.area)?.id || state.categories.find(c=>c.area===state.area)?.id || "";
    if(state.selected)localStorage.setItem(`tasks-selected-${state.area}`,state.selected);
    render();
  }));
  state.unsubs.push(onSnapshot(userCollection("tasks"), snapshot => {
    state.tasks=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    state.tasksLoaded=true;
    render();reminderService.tick();handleNotificationRoute();
  }));
}

async function activateSession(user,storageMode){
  reminderService.stop();state.unsubs.forEach(unsub=>unsub());state.unsubs=[];
  state.storageMode=storageMode;setStorageMode(storageMode);state.user=user;
  state.categories=[];state.tasks=[];state.tasksLoaded=false;state.view="tasks";
  $("#login").classList.toggle("hidden",!!user);
  $("#app").classList.toggle("hidden",!user);
  if(!user)return;
  $("#userName").textContent=storageMode==="local"?"שמירה מקומית":user.email||user.displayName||"";
  $("#storageModeLabel").textContent=storageMode==="local"?"⌂ הנתונים נשמרים במכשיר זה":"☁ הנתונים נשמרים בחשבון Google בענן";
  try{const saved=JSON.parse(localStorage.getItem(`my-tasks-notifications-${user.uid}`)||"{}");state.notifications={enabled:saved.enabled!==false,sound:soundChoices.includes(saved.sound)?saved.sound:"default",vibration:saved.vibration!==false};}catch{state.notifications={...notificationDefaults};}
  publishNotificationPreferences().catch(console.error);
  startSync();reminderService.start();handleNotificationRoute();offerInitialNotificationPermission();
  if(storageMode==="cloud")registerPushSubscription().catch(console.error);
}
async function enterLocal(){
  await reminderService.cancelPending();
  await unregisterPushSubscription();
  localStorage.setItem("my-tasks-storage-mode","local");
  await activateSession({uid:"local-device",displayName:"שמירה מקומית"},"local");
}
async function chooseStorageMode(){
  closeMenus();
  await reminderService.cancelPending();
  await unregisterPushSubscription();
  state.storageMode="choice";localStorage.removeItem("my-tasks-storage-mode");
  await activateSession(null,"choice");
}
async function leaveSession(){
  await chooseStorageMode();
  if(auth.currentUser)await signOut(auth);
}
onAuthStateChanged(auth, async user => {
  if(state.storageMode==="choice")return;
  if(state.storageMode==="local"&&state.user?.uid==="local-device")return;
  if(state.storageMode==="local")return activateSession({uid:"local-device",displayName:"שמירה מקומית"},"local");
  await activateSession(user,"cloud");
});

function selectArea(area) {
  state.area=area;
  localStorage.setItem("tasks-last-area",area);
  state.selected=state.categories.find(c=>c.id===savedCategory(area)&&c.area===area)?.id || state.categories.find(c=>c.area===area)?.id || "";
  if(state.selected)localStorage.setItem(`tasks-selected-${area}`,state.selected);
  closeMenus(); render();
}
function closeMenus(){ $$(".action-menu,.category-menu").forEach(el=>el.remove()); $("#appMenu").classList.add("hidden"); }

function render() {
  applySettings();
  $$(".platform-badge").forEach(el=>{el.textContent=window.MyTasksNative?.isNative?"APK":"PWA";el.title=window.MyTasksNative?.isNative?"אפליקציית Android":"אפליקציית אינטרנט";});
  document.documentElement.lang="he";
  document.documentElement.dir="rtl";
  $$("[data-i18n]").forEach(el=>el.textContent=t(el.dataset.i18n));
  $$("[data-view]").forEach(el=>el.classList.toggle("active",el.dataset.view===state.view));
  $$("[data-area]").forEach(el=>el.classList.toggle("active",el.dataset.area===state.area));
  $("#workCount").textContent=state.tasks.filter(x=>x.area==="work"&&!isArchived(x)).length;
  $("#privateCount").textContent=state.tasks.filter(x=>x.area==="private"&&!isArchived(x)).length;
  const calendarView=state.view==="calendar";
  $("#tasksPanel").classList.toggle("hidden",calendarView);
  $("#calendarView").classList.toggle("hidden",!calendarView);
  $("#addTaskTop").classList.toggle("hidden",state.view!=="tasks");
  $("#addTaskFab").classList.toggle("hidden",state.view!=="tasks");
  $("#viewTitle").classList.toggle("hidden",state.view==="tasks");
  $("#viewTitle").textContent=calendarView?"יומן":"היסטוריה";
  if(calendarView)renderCalendar();else{renderCategories();renderTasks();}
}

function selectCategory(id){
  state.selected=id;
  localStorage.setItem(`tasks-selected-${state.area}`,id);
  closeMenus();render();
}

function dateKey(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");}
function formatDue(task){
  if(!task.dueDate)return "";
  const date=new Date(task.dueDate+"T12:00:00");
  const label=new Intl.DateTimeFormat("he-IL",{day:"numeric",month:"short"}).format(date);
  return "📅 "+label+(task.dueTime?" · "+task.dueTime:"");
}
function formatReminder(task) {
  const date=scheduleReminder(task);if(!date)return "";
  const today=new Date(), tomorrow=new Date(today);tomorrow.setDate(today.getDate()+1);
  const day=date.toDateString()===today.toDateString()?"היום":date.toDateString()===tomorrow.toDateString()?"מחר":
    new Intl.DateTimeFormat("he-IL",{day:"numeric",month:"short"}).format(date);
  const notificationsReady=state.notifications.enabled&&state.notificationStatus?.display==="granted"&&(!state.notificationStatus.native||state.notificationStatus.exact==="granted");
  const icon=notificationsReady?"🔔":"⚠️";
  return `${icon} ${day} ${new Intl.DateTimeFormat("he-IL",{hour:"2-digit",minute:"2-digit"}).format(date)}`;
}
function renderCalendar(){
  const month=state.calendarMonth,year=month.getFullYear(),monthIndex=month.getMonth();
  $("#calendarMonthTitle").textContent=new Intl.DateTimeFormat("he-IL",{month:"long",year:"numeric"}).format(month);
  const firstDay=new Date(year,monthIndex,1).getDay(),days=new Date(year,monthIndex+1,0).getDate();
  const cells=[];
  for(let i=0;i<firstDay;i++)cells.push('<span class="calendar-day empty-day"></span>');
  for(let day=1;day<=days;day++){
    const key=dateKey(new Date(year,monthIndex,day));
    const count=state.tasks.filter(task=>task.dueDate===key&&!isArchived(task)).length;
    cells.push(`<button class="calendar-day ${key===state.selectedCalendarDate?"selected":""} ${key===todayKey?"today":""}" data-calendar-date="${key}"><span>${day}</span>${count?`<b>${count}</b>`:""}</button>`);
  }
  $("#calendarGrid").innerHTML=cells.join("");
  $$("[data-calendar-date]").forEach(button=>button.onclick=()=>{state.selectedCalendarDate=button.dataset.calendarDate;renderCalendar();});
  const selected=state.tasks.filter(task=>task.dueDate===state.selectedCalendarDate&&!isArchived(task)).sort((a,b)=>(a.dueTime||"99:99").localeCompare(b.dueTime||"99:99"));
  $("#calendarSelectedTitle").textContent=new Intl.DateTimeFormat("he-IL",{weekday:"long",day:"numeric",month:"long"}).format(new Date(state.selectedCalendarDate+"T12:00:00"));
  $("#calendarTaskList").innerHTML=selected.length?selected.map(task=>`<button class="calendar-task ${task.completedAt?"completed-task":""}" data-calendar-task="${task.id}"><span dir="${contentDirection(task.area)}">${escapeHtml(task.text)}</span><small>${task.dueTime||"כל היום"} · ${task.area==="private"?"פרטי":"עבודה"}</small></button>`).join(""):'<div class="calendar-empty">אין משימות ביום זה</div>';
  $$("[data-calendar-task]").forEach(button=>button.onclick=()=>openTask(state.tasks.find(task=>task.id===button.dataset.calendarTask)));
}
async function openTaskForDate(){
  state.area="private";localStorage.setItem("tasks-last-area","private");
  let category=state.categories.find(item=>item.area==="private");
  if(!category){
    const id="general-private";
    category={id,name:"כללי",area:"private",order:1000};
    state.categories.push(category);
    await safe(()=>setDoc(userDoc("categories",id),{name:"כללי",area:"private",order:1000,createdAt:serverTimestamp()},{merge:true}));
  }
  state.selected=category.id;localStorage.setItem("tasks-selected-private",category.id);
  openTask(null,state.selectedCalendarDate);
}
function shiftCalendarMonth(amount){state.calendarMonth=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth()+amount,1);renderCalendar();}
function addToPersonalCalendar(task){
  if(!task.dueDate){toast("יש להוסיף קודם תאריך למשימה");return;}
  const compact=value=>value.replace(/[-:]/g,"");
  const start=task.dueTime?compact(task.dueDate)+ "T"+compact(task.dueTime)+"00":compact(task.dueDate);
  const endDate=new Date(task.dueDate+"T12:00:00");endDate.setDate(endDate.getDate()+1);
  const end=task.dueTime?compact(task.dueDate)+"T"+String(Number(task.dueTime.slice(0,2))+1).padStart(2,"0")+task.dueTime.slice(3)+"00":dateKey(endDate).replace(/-/g,"");
  const esc=value=>String(value).replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
  const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//My Tasks//HE","BEGIN:VEVENT","UID:"+Date.now()+"@mytasks","DTSTAMP:"+new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,""),"DTSTART"+(task.dueTime?":":";VALUE=DATE:")+start,"DTEND"+(task.dueTime?":":";VALUE=DATE:")+end,"SUMMARY:"+esc(task.text),"END:VEVENT","END:VCALENDAR"].join("\r\n");
  const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([ics],{type:"text/calendar;charset=utf-8"}));link.download="my-task.ics";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

function renderCategories() {
  const categories=state.categories.filter(c=>c.area===state.area).sort((a,b)=>(a.order||0)-(b.order||0));
  const direction=contentDirection();
  const countFor=category=>state.tasks.filter(task=>task.categoryId===category.id&&(state.view==="history"?isArchived(task):!isArchived(task))).length;
  $("#categoryTabs").innerHTML=categories.map(c=>`<button class="category-tab ${c.id===state.selected?"active":""}" data-category="${c.id}" dir="${direction}"><span class="category-name">${escapeHtml(c.name)}</span><span class="category-count">${countFor(c)}</span></button>`).join("");
  $$("[data-category]").forEach(el=>el.onclick=()=>{if(!state.suppressCategoryClick)selectCategory(el.dataset.category);});
  requestAnimationFrame(updateCategoryOverflow);
}

function updateCategoryOverflow(){
  const tabs=$("#categoryTabs"),active=tabs.querySelector(".category-tab.active");
  tabs.scrollTop=0;
  const overflowing=tabs.scrollHeight>tabs.clientHeight+2;
  if(overflowing&&active&&active.offsetTop+active.offsetHeight>tabs.clientHeight)tabs.scrollTop=Math.max(0,active.offsetTop-(tabs.clientHeight-active.offsetHeight));
}

function renderTasks() {
  const items=state.tasks.filter(task=>task.area===state.area&&task.categoryId===state.selected&&(state.view==="history"?isArchived(task):!isArchived(task))).sort((a,b)=>{
    if(state.view==="history")return (b.archivedAt?.seconds||b.completedAt?.seconds||0)-(a.archivedAt?.seconds||a.completedAt?.seconds||0);
    if(!!a.completedAt!==!!b.completedAt)return a.completedAt?1:-1;
    if(a.completedAt&&b.completedAt)return (a.completedAt?.seconds||0)-(b.completedAt?.seconds||0);
    return (a.order??-(a.createdAt?.seconds||0))-(b.order??-(b.createdAt?.seconds||0));
  });
  $("#taskList").innerHTML=items.length?items.map(task=>`
    <article class="task-card ${state.view==="tasks"?"active-task":"history-task"} ${task.completedAt?"completed-task":""} ${task.urgent?"urgent":""}" data-task-id="${task.id}">
      ${state.view==="tasks"?`<button class="drag-handle" data-drag="${task.id}" aria-label="שינוי סדר">⠿</button>`:""}
      ${state.view==="tasks"&&!task.completedAt?`<button class="complete-btn" data-complete="${task.id}" aria-label="${t("done")}">✓</button>`:`<span class="history-check">✓</span>`}
      <div class="task-copy"><p dir="${contentDirection(task.area)}">${escapeHtml(task.text)}</p>${task.dueDate?`<small>${formatDue(task)}</small>`:""}${formatReminder(task)?`<small>${formatReminder(task)}</small>`:""}${task.completedAt?`<small>${t("completed")} ${formatDate(task.completedAt)}</small>`:""}</div>
      <div class="task-actions"><button class="icon-btn" data-actions="${task.id}" aria-label="אפשרויות משימה">•••</button></div>
    </article>`).join(""):`<div class="empty"><b>${t("empty")}</b><span>${t("emptyHint")}</span></div>`;
  $$("[data-complete]").forEach(el=>el.onclick=()=>openConfirm("complete",state.tasks.find(x=>x.id===el.dataset.complete)));
  $$("[data-actions]").forEach(el=>el.onclick=event=>{event.stopPropagation();openTaskMenu(el,state.tasks.find(x=>x.id===el.dataset.actions));});
  if(state.view==="tasks")initTaskDragging();
}

function initTaskDragging(){
  $$("[data-drag]").forEach(handle=>handle.onpointerdown=event=>{
    event.preventDefault(); closeMenus();
    const card=handle.closest(".task-card");
    const list=card.parentElement;
    const allCards=[...list.querySelectorAll(".task-card")];
    const siblings=allCards.filter(item=>item!==card);
    const startY=event.clientY;
    let currentY=startY;
    let targetIndex=allCards.indexOf(card);
    state.dragging=true;
    card.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);

    const markTarget=()=>{
      siblings.forEach(item=>item.classList.remove("drop-target"));
      const center=card.getBoundingClientRect().top+card.offsetHeight/2;
      targetIndex=siblings.findIndex(item=>center<item.getBoundingClientRect().top+item.offsetHeight/2);
      if(targetIndex<0)targetIndex=siblings.length;
      if(siblings[targetIndex])siblings[targetIndex].classList.add("drop-target");
    };

    handle.onpointermove=moveEvent=>{
      if(!state.dragging)return;
      moveEvent.preventDefault();
      currentY=moveEvent.clientY;
      card.style.transform=`translateY(${currentY-startY}px) scale(1.01)`;
      markTarget();
    };

    const finish=async()=>{
      if(!state.dragging)return;
      state.dragging=false;
      siblings.forEach(item=>item.classList.remove("drop-target"));
      card.classList.remove("dragging");
      card.style.transform="";
      if(siblings[targetIndex])list.insertBefore(card,siblings[targetIndex]);else list.append(card);
      handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;
      const ids=$$("#taskList .task-card").map(item=>item.dataset.taskId);
      await safe(async()=>{const batch=writeBatch(db);ids.forEach((id,index)=>batch.update(userDoc("tasks",id),{order:(index+1)*1000,updatedAt:serverTimestamp()}));await batch.commit();});
    };

    handle.onpointerup=finish;
    handle.onpointercancel=finish;
  });
}

function toggleUrgent(task){if(task)safe(()=>updateDoc(userDoc("tasks",task.id),{urgent:!task.urgent,updatedAt:serverTimestamp()}));}

function openTaskMenu(anchor,task) {
  closeMenus();
  const menu=document.createElement("div");menu.className="action-menu";
  if(state.view==="history"){
    menu.innerHTML=`<button data-act="restore">↶ שחזור למשימות</button><button data-act="delete" class="delete">♲ ${t("delete")}</button>`;
  }else if(task.completedAt){
    menu.innerHTML=`<button data-act="archive">↶ העבר להיסטוריה</button><button data-act="uncomplete">○ בטל סימון הושלם</button><button data-act="urgent">${task.urgent?"בטל דחיפות":"סמן כדחוף"}</button><button data-act="edit">✎ ${t("edit")}</button><button data-act="delete" class="delete">♲ ${t("delete")}</button>`;
  }else{
    menu.innerHTML=`<button data-act="urgent">${task.urgent?"בטל דחיפות":"סמן כדחוף"}</button><button data-act="edit">✎ ${t("edit")}</button><button data-act="move">↪ ${t("move")}</button>${task.dueDate?'<button data-act="calendar">📅 הוסף ליומן האישי</button>':""}<button data-act="delete" class="delete">♲ ${t("delete")}</button>`;
  }
  anchor.parentElement.append(menu);
  menu.querySelector('[data-act="urgent"]')?.addEventListener("click",()=>{closeMenus();toggleUrgent(task);});
  menu.querySelector('[data-act="edit"]')?.addEventListener("click",()=>openTask(task));
  menu.querySelector('[data-act="move"]')?.addEventListener("click",()=>openMove(task));
  menu.querySelector('[data-act="calendar"]')?.addEventListener("click",()=>{closeMenus();addToPersonalCalendar(task);});
  menu.querySelector('[data-act="archive"]')?.addEventListener("click",()=>safe(async()=>{const categoryId=await historyCategoryId(task);await updateDoc(userDoc("tasks",task.id),{categoryId,archivedAt:serverTimestamp()});closeMenus();}));
  menu.querySelector('[data-act="uncomplete"]')?.addEventListener("click",()=>safe(()=>updateDoc(userDoc("tasks",task.id),{completedAt:null,archivedAt:null})));
  menu.querySelector('[data-act="restore"]')?.addEventListener("click",()=>openConfirm("restore",task));
  menu.querySelector('[data-act="delete"]').onclick=()=>openConfirm("delete",task);
}

function openTask(task=null,presetDate="") {
  closeMenus(); state.editingTask=task;
  $("#saveTaskBtn").disabled=false;
  const category=state.categories.find(c=>c.id===(task?.categoryId||state.selected));
  if(!category){openCategory();toast("כדי להוסיף משימה, צור רשימה תחילה");return;}
  $("#taskDialogTitle").textContent=task?t("editTask"):t("newTask");
  $("#taskDialogCategory").textContent=category?.name||"";
  $("#taskText").value=task?.text||""; $("#taskText").placeholder=t("taskPlaceholder"); $("#taskText").dir=contentDirection(); $("#taskText").lang=contentLanguage();
  $("#taskDate").value=task?.dueDate||presetDate||"";$("#taskTime").value=task?.dueTime||"";
  $("#scheduleEditor").open=false;
  updateScheduleSummary();
  const reminder=task?.reminder;
  $("#reminderEditor").open=!!reminder?.enabled;
  $("#reminderEnabled").checked=!!reminder?.enabled;
  const reminderDate=reminder?.dateTime?.toDate?.() || (reminder?.dateTime?new Date(reminder.dateTime):null);
  $("#reminderDate").value=reminderDate ? [reminderDate.getFullYear(),String(reminderDate.getMonth()+1).padStart(2,"0"),String(reminderDate.getDate()).padStart(2,"0")].join("-") : "";
  $("#reminderTime").value=reminderDate ? [reminderDate.getHours(),reminderDate.getMinutes()].map(n=>String(n).padStart(2,"0")).join(":") : "";
  $("#reminderRepeat").value=reminder?.repeat||"none";$("#reminderLevel").value=reminder?.notificationLevel||"normal";
  $("#customInterval").value=reminder?.customRepeat?.interval||1;$("#customUnit").value=reminder?.customRepeat?.unit||"day";
  updateReminderFields();
  resetVoiceInput();
  $("#taskDialog").showModal(); setTimeout(()=>$("#taskText").focus(),50);
}
async function createTask(value,dueDate,dueTime,reminder){
  const maxOrder=Math.max(0,...state.tasks.filter(x=>x.categoryId===state.selected&&!x.completedAt).map(x=>x.order||0));
  const created=await addDoc(userCollection("tasks"),{text:value,area:state.area,categoryId:state.selected,order:maxOrder+1000,urgent:false,dueDate:dueDate||null,dueTime:dueDate?(dueTime||null):null,reminder,createdAt:serverTimestamp(),completedAt:null,archivedAt:null});
  return created.id;
}

function updateReminderFields(){
  $("#reminderFields").classList.toggle("hidden",!$("#reminderEnabled").checked);
  $("#customRepeatFields").classList.toggle("hidden",$("#reminderRepeat").value!=="custom");
}
function reminderInput(){return {enabled:$("#reminderEnabled").checked,date:$("#reminderDate").value,
  time:$("#reminderTime").value,repeat:$("#reminderRepeat").value,
  interval:$("#customInterval").value,unit:$("#customUnit").value,level:$("#reminderLevel").value};}
function updateScheduleSummary() {
  const date=$("#taskDate").value;
  const time=$("#taskTime").value;
  const summary=$("#scheduleSummary");
  if(!summary)return;
  if(!date){summary.textContent="📅 הוסף תאריך ושעה";return;}
  const [year,month,day]=date.split("-");
  summary.textContent=`📅 ${day}/${month}/${year}${time?` · ${time}`:""}`;
}

function escapeCalendarText(value="") {
  return String(value).replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
}

function calendarStamp(date) {
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0"),"T",String(date.getHours()).padStart(2,"0"),String(date.getMinutes()).padStart(2,"0"),String(date.getSeconds()).padStart(2,"0")].join("");
}

function downloadCalendarEvent(title,dueDate,dueTime) {
  const compactDate=dueDate.replaceAll("-","");
  let startLine,endLine;
  if(dueTime){
    const [year,month,day]=dueDate.split("-").map(Number);
    const [hour,minute]=dueTime.split(":").map(Number);
    const start=new Date(year,month-1,day,hour,minute,0);
    const end=new Date(start.getTime()+60*60*1000);
    startLine=`DTSTART:${calendarStamp(start)}`;
    endLine=`DTEND:${calendarStamp(end)}`;
  } else {
    const [year,month,day]=dueDate.split("-").map(Number);
    const next=new Date(year,month-1,day+1);
    const nextDate=[next.getFullYear(),String(next.getMonth()+1).padStart(2,"0"),String(next.getDate()).padStart(2,"0")].join("");
    startLine=`DTSTART;VALUE=DATE:${compactDate}`;
    endLine=`DTEND;VALUE=DATE:${nextDate}`;
  }
  const uid=`my-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}@azri-tasks`;
  const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//My Tasks//HE","CALSCALE:GREGORIAN","BEGIN:VEVENT",`UID:${uid}`,`DTSTAMP:${calendarStamp(new Date())}`,startLine,endLine,`SUMMARY:${escapeCalendarText(title)}`,"END:VEVENT","END:VCALENDAR"].join("\r\n");
  const url=URL.createObjectURL(new Blob([ics],{type:"text/calendar;charset=utf-8"}));
  const link=document.createElement("a");
  link.href=url;link.download="my-task.ics";document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function offerCalendarDownload(title,dueDate,dueTime) {
  if(!dueDate)return;
  setTimeout(()=>{
    if(confirm("המשימה נשמרה. להוסיף אותה ליומן?"))downloadCalendarEvent(title,dueDate,dueTime);
  },120);
}

async function saveTask(event) {
  event.preventDefault(); const value=$("#taskText").value.trim(); if(!value)return;
  const dueDate=$("#taskDate").value,dueTime=$("#taskTime").value;
  const saveButton=$("#saveTaskBtn"); saveButton.disabled=true;
  try {
    const input=reminderInput();
    const reminder=state.editingTask?updateReminder(state.editingTask.reminder,input):createReminder(input);
    const displayPermission=reminder.enabled&&state.notifications.enabled?reminderService.permission(false):Promise.resolve(true);
    let savedId=state.editingTask?.id||null;
    if(state.editingTask) await updateDoc(userDoc("tasks",state.editingTask.id),{text:value,dueDate:dueDate||null,dueTime:dueDate?(dueTime||null):null,reminder,updatedAt:serverTimestamp()});
    else savedId=await createTask(value,dueDate,dueTime,reminder);
    $("#taskDialog").close(); toast(t("saved"));
    offerCalendarDownload(value,dueDate,dueTime);
    if(reminder.enabled&&state.notifications.enabled) {
      const allowed=await displayPermission;
      if(!allowed)throw new Error("המשימה נשמרה, אך Android חוסם התראות");
      if(window.MyTasksNative?.isNative)await reminderService.permission(true);
      registerPushSubscription().catch(console.error);
    }
    if(savedId){
      const scheduled=await reminderService.scheduleNativeTask({id:savedId,text:value,reminder,completedAt:null,archivedAt:null});
      if(reminder.enabled&&state.notifications.enabled&&window.MyTasksNative?.isNative&&!scheduled.scheduled)throw new Error("המשימה נשמרה, אך התזכורת לא נרשמה ב־Android");
    }
    await refreshNotificationStatus(true);
    if(reminder.enabled && state.notifications.enabled && !window.MyTasksNative?.isNative && (!("Notification" in window) || Notification.permission!=="granted"))toast("התזכורת נשמרה, אך התראות אינן מורשות במכשיר זה");
  } catch(error) {console.error(error);toast(error.message||t("error"));}
  finally {saveButton.disabled=false;}
}

function openSettings(){
  closeMenus();
  $(`[name="themeSetting"][value="${state.settings.theme}"]`).checked=true;
  $(`[name="workLanguageSetting"][value="${state.settings.areaLanguages.work}"]`).checked=true;
  $(`[name="privateLanguageSetting"][value="${state.settings.areaLanguages.private}"]`).checked=true;
  $("#notificationsEnabledSetting").checked=state.notifications.enabled;
  $("#vibrationSetting").checked=state.notifications.vibration;
  $(`[name="soundSetting"][value="${state.notifications.sound}"]`).checked=true;
  updateNotificationSettingsUi();
  $("#settingsDialog").showModal();
  refreshNotificationStatus();
}
async function saveSettings(event){
  event.preventDefault();
  state.settings={theme:$("[name='themeSetting']:checked").value,areaLanguages:{work:$("[name='workLanguageSetting']:checked").value,private:$("[name='privateLanguageSetting']:checked").value}};
  state.notifications={enabled:$("#notificationsEnabledSetting").checked,sound:$("[name='soundSetting']:checked").value,vibration:$("#vibrationSetting").checked};
  localStorage.setItem(`my-tasks-notifications-${state.user.uid}`,JSON.stringify(state.notifications));
  localStorage.setItem("my-tasks-settings",JSON.stringify(state.settings));
  applySettings();
  $("#settingsDialog").close();
  render();toast(t("saved"));
  try{
    await publishNotificationPreferences();
    await reminderService.syncNative();
    if(state.notifications.enabled)await registerPushSubscription();
    else await unregisterPushSubscription();
    await refreshNotificationStatus(true);
  }catch(error){console.error(error);toast("ההגדרות נשמרו; סנכרון ההתראות נכשל — נסה שוב");}
}
async function publishNotificationPreferences(){
  if(!window.MyTasksNative?.isNative && "serviceWorker" in navigator){
    const registration=await navigator.serviceWorker.ready;
    (registration.active||navigator.serviceWorker.controller)?.postMessage({type:"notification-preferences",preferences:{...state.notifications,enabled:state.storageMode==="cloud"&&state.notifications.enabled}});
  }
}
async function requestNotificationPermission(){
  try{
    const allowed=await reminderService.permission(false);
    await refreshNotificationStatus(true);
    toast(allowed?"ההתראות אושרו":"ההתראות עדיין חסומות");
  }catch(error){console.error(error);toast(error.message||t("error"));}
}
async function testNotification(){
  const button=$("#testNotificationBtn");button.disabled=true;
  try{
    const result=await reminderService.testNotification();
    toast(result.warning?"הבדיקה נרשמה, אך ייתכן עיכוב ללא הרשאת תזמון מדויק":"התראת בדיקה תופיע בתוך כחמש שניות");
    await refreshNotificationStatus(true);
  }catch(error){console.error(error);toast(error.message||t("error"));}
  finally{button.disabled=false;}
}
async function openNotificationSettings(){try{await reminderService.openNotificationSettings();}catch(error){toast(error.message||t("error"));}}
async function openExactAlarmSettings(){try{await reminderService.openExactAlarmSettings();}catch(error){toast(error.message||t("error"));}}

function openCategory(category=null) {
  closeMenus(); state.editingCategory=category;
  $("#categoryDialogTitle").textContent=category?t("editList"):t("newList");
  $("#categoryName").value=category?.name||""; $("#categoryName").placeholder=t("listName"); $("#categoryName").dir=contentDirection(); $("#categoryName").lang=contentLanguage();
  $("#categoryDialog").showModal(); setTimeout(()=>$("#categoryName").focus(),50);
}
async function saveCategory(event) {
  event.preventDefault();const name=$("#categoryName").value.trim();if(!name)return;
  await safe(async()=>{
    if(state.editingCategory) await updateDoc(userDoc("categories",state.editingCategory.id),{name});
    else { const ref=await addDoc(userCollection("categories"),{name,area:state.area,order:Date.now(),createdAt:serverTimestamp()});state.selected=ref.id; }
    $("#categoryDialog").close();toast(t("saved"));
    if(state.reopenCategoryManager){state.reopenCategoryManager=false;setTimeout(openManageCategories,180);}
  });
}

function openMove(task) {
  closeMenus();state.movingTask=task;
  const options=state.categories.filter(c=>c.area===task.area);
  $("#moveTarget").innerHTML=options.map(c=>`<option value="${c.id}" ${c.id===task.categoryId?"selected":""}>${escapeHtml(c.name)}</option>`).join("");
  $("#moveDialog").showModal();
}
async function moveTask(event) {
  event.preventDefault();await safe(async()=>{await updateDoc(userDoc("tasks",state.movingTask.id),{categoryId:$("#moveTarget").value,updatedAt:serverTimestamp()});$("#moveDialog").close();toast(t("saved"));});
}

async function historyCategoryId(task){
  if(state.categories.some(category=>category.id===task.categoryId))return task.categoryId;
  const existing=state.categories.find(category=>category.area===task.area&&category.name==="כללי");
  if(existing)return existing.id;
  const id=`general-${task.area}`;
  await setDoc(userDoc("categories",id),{name:"כללי",area:task.area,order:999999,createdAt:serverTimestamp()},{merge:true});
  return id;
}

function openConfirm(type,item) {
  closeMenus();state.confirmAction={type,item};
  const title={complete:"completeTitle",delete:"deleteTitle",restore:"restoreTitle",deleteList:"deleteListTitle"}[type];
  const body={complete:"completeBody",delete:"deleteBody",restore:"restoreBody",deleteList:"deleteListBody"}[type];
  $("#confirmTitle").textContent=t(title);$("#confirmBody").textContent=t(body);$("#confirmButton").textContent=type==="delete"||type==="deleteList"?t("delete"):type==="restore"?t("restore"):t("done");
  $("#confirmButton").className=type==="delete"||type==="deleteList"?"danger-btn":"primary-btn";$("#confirmDialog").showModal();
}
async function confirmAction(event) {
  event.preventDefault();const {type,item}=state.confirmAction;
  await safe(async()=>{
    if(type==="complete")await reminderService.markReminderCompleted(item.id);
    if(type==="restore")await updateDoc(userDoc("tasks",item.id),{completedAt:null,archivedAt:null});
    if(type==="delete")await deleteDoc(userDoc("tasks",item.id));
    if(type==="deleteList"){
      if(state.tasks.some(task=>task.categoryId===item.id)){toast(t("listNotEmpty"));$("#confirmDialog").close();if(state.reopenCategoryManager){state.reopenCategoryManager=false;setTimeout(openManageCategories,120);}return;}
      await deleteDoc(userDoc("categories",item.id));state.selected=state.categories.find(c=>c.area===state.area&&c.id!==item.id)?.id||"";if(state.selected)localStorage.setItem(`tasks-selected-${state.area}`,state.selected);
    }
    $("#confirmDialog").close();
    if(type==="deleteList"&&state.reopenCategoryManager){state.reopenCategoryManager=false;setTimeout(openManageCategories,180);}
  });
}

let handlingNotification=false;
async function handleNotificationRoute() {
  if(handlingNotification)return;
  const params=new URLSearchParams(location.search);
  const taskId=params.get("task"), action=params.get("action");
  if(!taskId || !state.user || !state.tasksLoaded) return;
  handlingNotification=true;
  // Action links are processed after sign-in and only within the signed-in user's collection.
  if(action) {
    try {
      if(action==="done")await reminderService.markReminderCompleted(taskId);
      if(action==="snooze10" || action==="snooze60")await reminderService.snoozeReminder(taskId,action==="snooze10"?10:60);
    } catch(error) {console.error(error);toast(t("error"));handlingNotification=false;return;}
  }
  const task=state.tasks.find(item=>item.id===taskId);
  if(task) {
    state.area=task.area;state.selected=task.categoryId;state.view="tasks";render();
    document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.scrollIntoView({block:"center"});
  }
  history.replaceState(null,"",location.pathname);
  handlingNotification=false;
}

navigator.serviceWorker?.addEventListener("message",event=>{
  if(event.data?.type!=="reminder-action")return;
  const {taskId,action}=event.data;
  const url=new URL(location.href);url.searchParams.set("task",taskId);
  if(action)url.searchParams.set("action",action);
  history.replaceState(null,"",url);
  handleNotificationRoute();
});

function renderManageCategories(){
  const categories=state.categories.filter(c=>c.area===state.area).sort((a,b)=>(a.order||0)-(b.order||0));
  $("#manageCategoriesArea").textContent=state.area==="private"?"פרטי":"עבודה";
  $("#manageCategoriesList").innerHTML=categories.length?categories.map((category,index)=>`<div class="manage-category-row" data-manage-category="${category.id}">
    <div class="manage-order-controls"><button type="button" data-manage-move="-1" ${index===0?"disabled":""} aria-label="העלה">▲</button><button type="button" data-manage-move="1" ${index===categories.length-1?"disabled":""} aria-label="הורד">▼</button></div>
    <span class="manage-category-name" dir="${contentDirection()}">${escapeHtml(category.name)}</span>
    <button class="manage-category-edit" type="button" aria-label="שינוי שם">✎</button>
    <button class="manage-category-delete" type="button" aria-label="מחיקה">🗑️</button>
  </div>`).join(""):'<div class="empty"><b>אין תתי־קטגוריות</b></div>';
  $$("[data-manage-category]").forEach(row=>{
    const category=state.categories.find(c=>c.id===row.dataset.manageCategory);
    row.querySelectorAll("[data-manage-move]").forEach(button=>button.onclick=()=>moveManagedCategory(category.id,Number(button.dataset.manageMove)));
    row.querySelector(".manage-category-edit").onclick=()=>editManagedCategory(row,category);
    row.querySelector(".manage-category-delete").onclick=()=>deleteManagedCategory(category);
  });
}

async function persistManagedCategoryOrder(categories){
  categories.forEach((category,index)=>category.order=(index+1)*1000);renderManageCategories();renderCategories();
  await safe(async()=>{const batch=writeBatch(db);categories.forEach(category=>batch.update(userDoc("categories",category.id),{order:category.order}));await batch.commit();});
}

function moveManagedCategory(id,direction){
  const categories=state.categories.filter(c=>c.area===state.area).sort((a,b)=>(a.order||0)-(b.order||0)),index=categories.findIndex(c=>c.id===id),target=index+direction;
  if(index<0||target<0||target>=categories.length)return;
  categories.splice(target,0,categories.splice(index,1)[0]);persistManagedCategoryOrder(categories);
}

function editManagedCategory(row,category){
  row.classList.add("editing");
  row.innerHTML=`<input class="manage-category-input" value="${escapeHtml(category.name)}" dir="${contentDirection()}"><button class="manage-inline-save primary-btn" type="button">שמירה</button><button class="manage-inline-cancel secondary-btn" type="button">ביטול</button>`;
  const input=row.querySelector("input");input.focus();input.select();
  row.querySelector(".manage-inline-cancel").onclick=renderManageCategories;
  row.querySelector(".manage-inline-save").onclick=async()=>{const name=input.value.trim();if(!name)return;await safe(async()=>{await updateDoc(userDoc("categories",category.id),{name});category.name=name;renderManageCategories();renderCategories();toast(t("saved"));});};
}

async function deleteManagedCategory(category){
  if(state.tasks.some(task=>task.categoryId===category.id)){toast(t("listNotEmpty"));return;}
  if(!confirm(`למחוק את תת־הקטגוריה “${category.name}”?`))return;
  await safe(async()=>{await deleteDoc(userDoc("categories",category.id));state.categories=state.categories.filter(c=>c.id!==category.id);if(state.selected===category.id){state.selected=state.categories.find(c=>c.area===state.area)?.id||"";if(state.selected)localStorage.setItem(`tasks-selected-${state.area}`,state.selected);}renderManageCategories();render();});
}

function addManagedCategory(){
  const list=$("#manageCategoriesList");
  if(list.querySelector(".manage-category-row.editing"))return;
  if(list.querySelector(".empty"))list.innerHTML="";
  const row=document.createElement("div");row.className="manage-category-row editing";row.innerHTML=`<input class="manage-category-input" placeholder="שם תת־קטגוריה" dir="${contentDirection()}"><button class="manage-inline-save primary-btn" type="button">הוספה</button><button class="manage-inline-cancel secondary-btn" type="button">ביטול</button>`;list.append(row);
  const input=row.querySelector("input");input.focus();row.querySelector(".manage-inline-cancel").onclick=renderManageCategories;
  row.querySelector(".manage-inline-save").onclick=async()=>{const name=input.value.trim();if(!name)return;await safe(async()=>{const ref=await addDoc(userCollection("categories"),{name,area:state.area,order:Date.now(),createdAt:serverTimestamp()});state.categories.push({id:ref.id,name,area:state.area,order:Date.now()});renderManageCategories();renderCategories();toast(t("saved"));});};
}

function openManageCategories(){
  closeMenus();renderManageCategories();$("#manageCategoriesDialog").showModal();
}

initVoiceInput();
$("#loginBtn").onclick=login;
$("#localLoginBtn").onclick=()=>safe(enterLocal);
$("#menuStorageModeBtn").onclick=()=>safe(chooseStorageMode);
[$("#logoutBtn"),$("#menuLogoutBtn")].forEach(button=>button.onclick=()=>safe(leaveSession));
$$(".app-menu-btn").forEach(button=>button.onclick=event=>{event.stopPropagation();const menu=$("#appMenu");const opening=menu.classList.contains("hidden");closeMenus();if(opening){const rect=button.getBoundingClientRect();menu.style.top=`${rect.bottom+6}px`;menu.style.right=`${Math.max(12,innerWidth-rect.right)}px`;menu.classList.remove("hidden");}});
$$("[data-menu-view]").forEach(button=>button.onclick=()=>{state.view=button.dataset.menuView;closeMenus();render();});
$("#menuSettingsBtn").onclick=openSettings;
$("#menuCategoriesBtn").onclick=openManageCategories;
$("#requestNotificationPermissionBtn").onclick=requestNotificationPermission;
$("#testNotificationBtn").onclick=testNotification;
$("#previewSoundBtn").onclick=async()=>{try{await window.MyTasksNative.NotificationSettings.previewSound({sound:$("[name='soundSetting']:checked").value});}catch(error){toast(error.message||t("error"));}};
$("#openNotificationSettingsBtn").onclick=openNotificationSettings;
$("#openExactAlarmSettingsBtn").onclick=openExactAlarmSettings;
$$("[data-area]").forEach(el=>el.onclick=()=>selectArea(el.dataset.area));
$("#addTaskTop").onclick=()=>openTask();$("#addTaskFab").onclick=()=>openTask();$("#manageAddCategoryBtn").onclick=addManagedCategory;
$("#calendarPrev").onclick=()=>shiftCalendarMonth(-1);$("#calendarNext").onclick=()=>shiftCalendarMonth(1);$("#calendarAddTask").onclick=openTaskForDate;
$("#taskText").oninput=event=>event.target.dir=contentDirection();
$("#categoryName").oninput=event=>event.target.dir=contentDirection();
$("#taskForm").onsubmit=saveTask;$("#categoryForm").onsubmit=saveCategory;$("#moveForm").onsubmit=moveTask;$("#confirmForm").onsubmit=confirmAction;$("#settingsForm").onsubmit=saveSettings;
$("#taskDate").oninput=updateScheduleSummary;$("#taskTime").oninput=updateScheduleSummary;
$("#reminderEnabled").onchange=updateReminderFields;$("#reminderRepeat").onchange=updateReminderFields;
$$("[data-close-dialog]").forEach(button=>button.onclick=()=>$("#"+button.dataset.closeDialog).close());
$$("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();}));
document.addEventListener("click",event=>{if(!event.target.closest(".task-actions")&&!event.target.closest("#appMenu"))closeMenus();});
if("serviceWorker" in navigator){
  let reloadingForUpdate=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(reloadingForUpdate)return;
    reloadingForUpdate=true;
    location.reload();
  });
  navigator.serviceWorker.register("./service-worker.js?v=2.5.0",{updateViaCache:"none"})
    .then(registration=>registration.update())
    .catch(console.error);
}
applySettings();
render();

if(state.storageMode==="local")activateSession({uid:"local-device",displayName:"שמירה מקומית"},"local").catch(console.error);
