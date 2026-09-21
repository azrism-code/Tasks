import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA-w1TXwBN2pAC-FOL4ZAT-FxJO2okduVk",
  authDomain: "azri-tasks.firebaseapp.com",
  projectId: "azri-tasks",
  storageBucket: "azri-tasks.firebasestorage.app",
  messagingSenderId: "707546310998",
  appId: "1:707546310998:web:174b4d8ce9fa0df5040ef7"
};

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
const todayKey=new Date().toISOString().slice(0,10);
const state = { user:null, language:"he", area:lastArea, view:"tasks", selected:savedCategory(lastArea), categories:[], tasks:[], editingTask:null, editingCategory:null, movingTask:null, confirmAction:null, unsubs:[], dragging:false, categoriesExpanded:false, suppressCategoryClick:false, calendarMonth:new Date(new Date().getFullYear(),new Date().getMonth(),1), selectedCalendarDate:todayKey };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const t = key => text[state.language][key] || key;
const isHebrew = value => /[\u0590-\u05FF]/.test(value);
const isArchived = task => !!task.archivedAt || (!!task.completedAt && task.archivedAt===undefined);
const userCollection = name => collection(db,"users",state.user.uid,name);
const userDoc = (name,id) => doc(db,"users",state.user.uid,name,id);
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
    voiceRecognition.lang=state.area==="private"?"he-IL":"en-US";
    status.textContent=state.area==="private"?"מקשיב בעברית…":"Listening in English…";
    try{voiceRecognition.start();}catch(error){console.error(error);status.textContent="לא ניתן להתחיל הקלטה. נסה שוב.";}
  };
  voiceRecognition.onstart=()=>{voiceListening=true;setVoiceButton(true);};
  voiceRecognition.onresult=event=>{
    let transcript="";
    for(let index=0;index<event.results.length;index++)transcript+=event.results[index][0].transcript;
    const input=$("#taskText");
    input.value=[baseText,transcript.trim()].filter(Boolean).join(" ");
    input.dir=isHebrew(input.value)?"rtl":"ltr";
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
  $("#voiceStatus").textContent=voiceSupported?(state.area==="private"?"זיהוי דיבור בעברית":"Speech recognition in English"):"להכתבה קולית יש לפתוח את האפליקציה ב-Chrome";
}

async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  try { await signInWithPopup(auth,provider); }
  catch (error) {
    if (["auth/popup-blocked","auth/popup-closed-by-user","auth/cancelled-popup-request"].includes(error.code)) await signInWithRedirect(auth,provider);
    else { console.error(error); toast(t("error")); }
  }
}

function startSync() {
  state.unsubs.forEach(unsub=>unsub()); state.unsubs=[];
  state.unsubs.push(onSnapshot(userCollection("categories"), snapshot => {
    state.categories=snapshot.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    if (!state.categories.some(c=>c.id===state.selected&&c.area===state.area)) state.selected=state.categories.find(c=>c.id===savedCategory(state.area)&&c.area===state.area)?.id || state.categories.find(c=>c.area===state.area)?.id || "";
    if(state.selected)localStorage.setItem(`tasks-selected-${state.area}`,state.selected);
    render();
  }));
  state.unsubs.push(onSnapshot(userCollection("tasks"), snapshot => {
    state.tasks=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    render();
  }));
}

onAuthStateChanged(auth, async user => {
  state.user=user;
  $("#login").classList.toggle("hidden",!!user);
  $("#app").classList.toggle("hidden",!user);
  if (!user) { state.unsubs.forEach(unsub=>unsub()); state.unsubs=[]; return; }
  $("#userName").textContent=user.email || user.displayName || "";
  startSync();
});

function selectArea(area) {
  state.area=area;
  localStorage.setItem("tasks-last-area",area);
  state.selected=state.categories.find(c=>c.id===savedCategory(area)&&c.area===area)?.id || state.categories.find(c=>c.area===area)?.id || "";
  if(state.selected)localStorage.setItem(`tasks-selected-${area}`,state.selected);
  closeMenus(); render();
}
function closeMenus(){ $$(".action-menu,.category-menu").forEach(el=>el.remove()); $("#appMenu").classList.add("hidden"); $("#categoryPicker").classList.add("hidden"); }

function render() {
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
  $("#calendarTaskList").innerHTML=selected.length?selected.map(task=>`<button class="calendar-task ${task.completedAt?"completed-task":""}" data-calendar-task="${task.id}"><span dir="auto">${escapeHtml(task.text)}</span><small>${task.dueTime||"כל היום"} · ${task.area==="private"?"פרטי":"עבודה"}</small></button>`).join(""):'<div class="calendar-empty">אין משימות ביום זה</div>';
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
  const categories=state.categories.filter(c=>c.area===state.area);
  const countFor=category=>state.tasks.filter(task=>task.categoryId===category.id&&(state.view==="history"?isArchived(task):!isArchived(task))).length;
  $("#categoryTabs").innerHTML=categories.map(c=>`<button class="category-tab ${c.id===state.selected?"active":""}" data-category="${c.id}"><span class="category-drag" aria-label="שינוי סדר">⠿</span><span class="category-name" dir="auto">${escapeHtml(c.name)}</span><span class="category-count">${countFor(c)}</span></button>`).join("")+`<button id="addCategory" class="category-add" aria-label="הוספת תת קטגוריה">＋</button>`;
  $("#categoryPicker").innerHTML=categories.map(c=>`<button class="${c.id===state.selected?"active":""}" data-pick-category="${c.id}"><span dir="auto">${escapeHtml(c.name)}</span><b>${countFor(c)}</b></button>`).join("");
  $$("[data-category]").forEach(el=>el.onclick=()=>{if(!state.suppressCategoryClick)selectCategory(el.dataset.category);});
  $$("[data-pick-category]").forEach(el=>el.onclick=()=>selectCategory(el.dataset.pickCategory));
  $("#addCategory").onclick=()=>openCategory();
  initCategoryDragging();
  requestAnimationFrame(updateCategoryOverflow);
}

function updateCategoryOverflow(){
  const tabs=$("#categoryTabs"),button=$("#moreCategoriesBtn"),active=tabs.querySelector(".category-tab.active");
  tabs.scrollTop=0;
  const overflowing=tabs.scrollHeight>tabs.clientHeight+2;
  tabs.classList.toggle("has-overflow",overflowing);
  button.classList.toggle("hidden",!overflowing);
  if(overflowing&&active&&active.offsetTop+active.offsetHeight>tabs.clientHeight)tabs.scrollTop=Math.max(0,active.offsetTop-(tabs.clientHeight-active.offsetHeight));
}

function toggleCategoryPicker(event){
  event.stopPropagation();
  $("#categoryPicker").classList.toggle("hidden");
}

function initCategoryDragging(){
  $$(".category-drag").forEach(handle=>handle.onpointerdown=event=>{
    event.preventDefault();event.stopPropagation();
    const tab=handle.closest(".category-tab"),tabs=$("#categoryTabs"),rect=tab.getBoundingClientRect();
    const clone=tab.cloneNode(true);
    clone.classList.add("category-drag-clone");
    Object.assign(clone.style,{position:"fixed",left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,pointerEvents:"none",zIndex:"100"});
    document.body.append(clone);tab.classList.add("category-drag-source");
    const offsetX=event.clientX-rect.left,offsetY=event.clientY-rect.top,startX=event.clientX,startY=event.clientY;
    let moved=false;handle.setPointerCapture(event.pointerId);
    handle.onpointermove=moveEvent=>{
      moveEvent.preventDefault();
      if(Math.hypot(moveEvent.clientX-startX,moveEvent.clientY-startY)>5){moved=true;state.suppressCategoryClick=true;}
      clone.style.left=`${moveEvent.clientX-offsetX}px`;clone.style.top=`${moveEvent.clientY-offsetY}px`;
      const target=document.elementFromPoint(moveEvent.clientX,moveEvent.clientY)?.closest(".category-tab");
      if(!moved||!target||target===tab||target.parentElement!==tabs)return;
      const box=target.getBoundingClientRect(),sameRow=Math.abs(moveEvent.clientY-(box.top+box.height/2))<box.height/2;
      const before=sameRow?moveEvent.clientX>box.left+box.width/2:moveEvent.clientY<box.top+box.height/2;
      tabs.insertBefore(tab,before?target:target.nextSibling);
    };
    const finish=async()=>{
      clone.remove();tab.classList.remove("category-drag-source");
      handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;
      if(moved){
        const ids=$$("#categoryTabs [data-category]").map(item=>item.dataset.category);
        await safe(async()=>{const batch=writeBatch(db);ids.forEach((id,index)=>batch.update(userDoc("categories",id),{order:(index+1)*1000}));await batch.commit();});
      }
      setTimeout(()=>{state.suppressCategoryClick=false;},120);
    };
    handle.onpointerup=finish;handle.onpointercancel=finish;
  });
}

function renderTasks() {
  const category=state.categories.find(c=>c.id===state.selected);
  $("#categoryTitle").textContent=category?.name || "";
  $("#categoryTitle").dir="auto";
  const items=state.tasks.filter(task=>task.area===state.area&&task.categoryId===state.selected&&(state.view==="history"?isArchived(task):!isArchived(task))).sort((a,b)=>{
    if(state.view==="history")return (b.archivedAt?.seconds||b.completedAt?.seconds||0)-(a.archivedAt?.seconds||a.completedAt?.seconds||0);
    if(!!a.completedAt!==!!b.completedAt)return a.completedAt?1:-1;
    if(a.completedAt&&b.completedAt)return (a.completedAt?.seconds||0)-(b.completedAt?.seconds||0);
    return (a.order??-(a.createdAt?.seconds||0))-(b.order??-(b.createdAt?.seconds||0));
  });
  $("#taskCount").textContent=`${items.length} ${t("taskCount")}`;
  $("#taskList").innerHTML=items.length?items.map(task=>`
    <article class="task-card ${state.view==="tasks"?"active-task":"history-task"} ${task.completedAt?"completed-task":""} ${task.urgent?"urgent":""}" data-task-id="${task.id}">
      ${state.view==="tasks"?`<button class="drag-handle" data-drag="${task.id}" aria-label="שינוי סדר">⠿</button>`:""}
      ${state.view==="tasks"&&!task.completedAt?`<button class="complete-btn" data-complete="${task.id}" aria-label="${t("done")}">✓</button>`:`<span class="history-check">✓</span>`}
      <div class="task-copy"><p dir="${isHebrew(task.text)?"rtl":"ltr"}">${escapeHtml(task.text)}</p>${task.dueDate?`<small>${formatDue(task)}</small>`:""}${task.completedAt?`<small>${t("completed")} ${formatDate(task.completedAt)}</small>`:""}</div>
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
  const category=state.categories.find(c=>c.id===(task?.categoryId||state.selected));
  if(!category){toast(t("error"));return;}
  $("#taskDialogTitle").textContent=task?t("editTask"):t("newTask");
  $("#taskDialogCategory").textContent=category?.name||"";
  $("#taskText").value=task?.text||""; $("#taskText").placeholder=t("taskPlaceholder"); $("#taskText").dir=isHebrew($("#taskText").value)?"rtl":"ltr";
  $("#taskDate").value=task?.dueDate||presetDate||"";$("#taskTime").value=task?.dueTime||"";
  resetVoiceInput();
  $("#taskDialog").showModal(); setTimeout(()=>$("#taskText").focus(),50);
}
async function createTask(value,dueDate,dueTime){
  const maxOrder=Math.max(0,...state.tasks.filter(x=>x.categoryId===state.selected&&!x.completedAt).map(x=>x.order||0));
  await addDoc(userCollection("tasks"),{text:value,area:state.area,categoryId:state.selected,order:maxOrder+1000,urgent:false,dueDate:dueDate||null,dueTime:dueDate?(dueTime||null):null,createdAt:serverTimestamp(),completedAt:null,archivedAt:null});
}

async function saveTask(event) {
  event.preventDefault(); const value=$("#taskText").value.trim(); if(!value)return;
  const dueDate=$("#taskDate").value,dueTime=$("#taskTime").value;
  const saveButton=$("#saveTaskBtn"); saveButton.disabled=true;
  await safe(async()=>{
    if(state.editingTask) await updateDoc(userDoc("tasks",state.editingTask.id),{text:value,dueDate:dueDate||null,dueTime:dueDate?(dueTime||null):null,updatedAt:serverTimestamp()});
    else await createTask(value,dueDate,dueTime);
    $("#taskDialog").close(); toast(t("saved"));
  });
  saveButton.disabled=false;
}

function openCategory(category=null) {
  closeMenus(); state.editingCategory=category;
  $("#categoryDialogTitle").textContent=category?t("editList"):t("newList");
  $("#categoryName").value=category?.name||""; $("#categoryName").placeholder=t("listName");
  $("#categoryDialog").showModal(); setTimeout(()=>$("#categoryName").focus(),50);
}
async function saveCategory(event) {
  event.preventDefault();const name=$("#categoryName").value.trim();if(!name)return;
  await safe(async()=>{
    if(state.editingCategory) await updateDoc(userDoc("categories",state.editingCategory.id),{name});
    else { const ref=await addDoc(userCollection("categories"),{name,area:state.area,order:Date.now(),createdAt:serverTimestamp()});state.selected=ref.id; }
    $("#categoryDialog").close();toast(t("saved"));
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
    if(type==="complete")await updateDoc(userDoc("tasks",item.id),{completedAt:serverTimestamp(),archivedAt:null});
    if(type==="restore")await updateDoc(userDoc("tasks",item.id),{completedAt:null,archivedAt:null});
    if(type==="delete")await deleteDoc(userDoc("tasks",item.id));
    if(type==="deleteList"){
      if(state.tasks.some(task=>task.categoryId===item.id)){toast(t("listNotEmpty"));$("#confirmDialog").close();return;}
      await deleteDoc(userDoc("categories",item.id));state.selected=state.categories.find(c=>c.area===state.area&&c.id!==item.id)?.id||"";if(state.selected)localStorage.setItem(`tasks-selected-${state.area}`,state.selected);
    }
    $("#confirmDialog").close();
  });
}

function openCategoryMenu() {
  const category=state.categories.find(c=>c.id===state.selected);if(!category)return;closeMenus();
  const wrap=$("#categoryMenuBtn").parentElement;wrap.style.position="relative";
  const menu=document.createElement("div");menu.className="category-menu";menu.innerHTML=`<button data-cat="edit">✎ ${t("edit")}</button><button data-cat="delete" class="delete">♲ ${t("delete")}</button>`;wrap.append(menu);
  menu.querySelector('[data-cat="edit"]').onclick=()=>openCategory(category);
  menu.querySelector('[data-cat="delete"]').onclick=()=>openConfirm("deleteList",category);
}

initVoiceInput();
$("#loginBtn").onclick=login;
[$("#logoutBtn"),$("#menuLogoutBtn")].forEach(button=>button.onclick=()=>signOut(auth));
$$(".app-menu-btn").forEach(button=>button.onclick=event=>{event.stopPropagation();const menu=$("#appMenu");const opening=menu.classList.contains("hidden");closeMenus();if(opening){const rect=button.getBoundingClientRect();menu.style.top=`${rect.bottom+6}px`;menu.style.right=`${Math.max(12,innerWidth-rect.right)}px`;menu.classList.remove("hidden");}});
$$("[data-menu-view]").forEach(button=>button.onclick=()=>{state.view=button.dataset.menuView;closeMenus();render();});
$$("[data-area]").forEach(el=>el.onclick=()=>selectArea(el.dataset.area));
$("#addTaskTop").onclick=()=>openTask();$("#addTaskFab").onclick=()=>openTask();$("#categoryMenuBtn").onclick=openCategoryMenu;$("#moreCategoriesBtn").onclick=toggleCategoryPicker;
$("#calendarPrev").onclick=()=>shiftCalendarMonth(-1);$("#calendarNext").onclick=()=>shiftCalendarMonth(1);$("#calendarAddTask").onclick=openTaskForDate;
$("#taskText").oninput=event=>event.target.dir=isHebrew(event.target.value)?"rtl":"ltr";
$("#categoryName").oninput=event=>event.target.dir=isHebrew(event.target.value)?"rtl":"ltr";
$("#taskForm").onsubmit=saveTask;$("#categoryForm").onsubmit=saveCategory;$("#moveForm").onsubmit=moveTask;$("#confirmForm").onsubmit=confirmAction;
$$("[data-close-dialog]").forEach(button=>button.onclick=()=>$("#"+button.dataset.closeDialog).close());
$$("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();}));
document.addEventListener("click",event=>{if(!event.target.closest(".task-actions")&&!event.target.closest("#categoryMenuBtn")&&!event.target.closest("#appMenu"))closeMenus();});
if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js");
render();
