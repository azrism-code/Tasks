import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDocs, serverTimestamp, writeBatch
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

const defaults = [
  ["integration","Integration","work",10],["training","Training","work",20],["lab","LAB","work",30],
  ["collateral","Collateral","work",40],["buy","To Buy","private",10],["fix","To Fix","private",20],["mom","Mom","private",30]
];
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
    completeBody:"המשימה תעבור להיסטוריה ויתווסף לה תאריך השלמה.",
    deleteTitle:"למחוק את המשימה?",deleteBody:"לא ניתן לבטל פעולה זו.",restoreTitle:"לשחזר את המשימה?",
    restoreBody:"המשימה תחזור לרשימה הפעילה.",deleteListTitle:"למחוק את הרשימה?",
    deleteListBody:"אפשר למחוק רק רשימה ריקה.",listNotEmpty:"יש להעביר או למחוק קודם את המשימות שלה.",
    saved:"נשמר",error:"משהו השתבש. נסה שוב.",confirm:"אישור"
  }
};

const lastArea=["work","private"].includes(localStorage.getItem("tasks-last-area"))?localStorage.getItem("tasks-last-area"):"work";
const savedCategory = area => localStorage.getItem(`tasks-selected-${area}`) || "";
const state = { user:null, language:"he", area:lastArea, view:"tasks", selected:savedCategory(lastArea), categories:[], tasks:[], editingTask:null, editingCategory:null, movingTask:null, confirmAction:null, unsubs:[], dragging:false };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const t = key => text[state.language][key] || key;
const isHebrew = value => /[\u0590-\u05FF]/.test(value);
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
  button.innerHTML=listening?"⏹️ <span>עצור הקלטה</span>":"🎙️ <span>הקלט משימה</span>";
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

async function seedCategories() {
  const snapshot = await getDocs(userCollection("categories"));
  if (!snapshot.empty) return;
  await Promise.all(defaults.map(([id,name,area,order]) => setDoc(userDoc("categories",id),{name,area,order,createdAt:serverTimestamp()})));
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
  safe(seedCategories);
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
  document.documentElement.lang="he";
  document.documentElement.dir="rtl";
  $$("[data-i18n]").forEach(el=>el.textContent=t(el.dataset.i18n));
  $$("[data-view]").forEach(el=>el.classList.toggle("active",el.dataset.view===state.view));
  $$("[data-area]").forEach(el=>el.classList.toggle("active",el.dataset.area===state.area));
  $("#workCount").textContent=state.tasks.filter(x=>x.area==="work"&&!x.completedAt).length;
  $("#privateCount").textContent=state.tasks.filter(x=>x.area==="private"&&!x.completedAt).length;
  $("#addTaskTop").classList.toggle("hidden",state.view==="history");
  $("#addTaskFab").classList.toggle("hidden",state.view==="history");
  $("#viewTitle").classList.toggle("hidden",state.view!=="history");
  $("#viewTitle").textContent="היסטוריה";
  renderCategories(); renderTasks();
}

function renderCategories() {
  const categories=state.categories.filter(c=>c.area===state.area);
  $("#categoryTabs").innerHTML=categories.map(c=>{const count=state.tasks.filter(task=>task.categoryId===c.id&&(state.view==="history"?!!task.completedAt:!task.completedAt)).length;return `<button class="category-tab ${c.id===state.selected?"active":""}" data-category="${c.id}"><span class="category-name" dir="auto">${escapeHtml(c.name)}</span><span class="category-count">${count}</span></button>`;}).join("")+`<button id="addCategory" class="category-add" aria-label="Add list">＋</button>`;
  $$("[data-category]").forEach(el=>el.onclick=()=>{state.selected=el.dataset.category;localStorage.setItem(`tasks-selected-${state.area}`,state.selected);closeMenus();render();});
  $("#addCategory").onclick=()=>openCategory();
}

function renderTasks() {
  const category=state.categories.find(c=>c.id===state.selected);
  $("#categoryTitle").textContent=category?.name || "";
  $("#categoryTitle").dir="auto";
  const items=state.tasks.filter(task=>task.area===state.area&&task.categoryId===state.selected&&(state.view==="history"?!!task.completedAt:!task.completedAt)).sort((a,b)=>state.view==="history"?(b.completedAt?.seconds||0)-(a.completedAt?.seconds||0):(a.order??-(a.createdAt?.seconds||0))-(b.order??-(b.createdAt?.seconds||0)));
  $("#taskCount").textContent=`${items.length} ${t("taskCount")}`;
  $("#taskList").innerHTML=items.length?items.map(task=>`
    <article class="task-card ${state.view==="tasks"?"active-task":"history-task"} ${task.urgent?"urgent":""}" data-task-id="${task.id}">
      ${state.view==="tasks"?`<button class="drag-handle" data-drag="${task.id}" aria-label="שינוי סדר">⠿</button>`:""}
      ${state.view==="tasks"?`<button class="complete-btn" data-complete="${task.id}" aria-label="${t("done")}">✓</button>`:`<span class="history-check">✓</span>`}
      <div class="task-copy"><p dir="${isHebrew(task.text)?"rtl":"ltr"}">${escapeHtml(task.text)}</p>${task.completedAt?`<small>${t("completed")} ${formatDate(task.completedAt)}</small>`:""}</div>
      <div class="task-actions"><button class="icon-btn" data-actions="${task.id}" aria-label="Task options">•••</button></div>
    </article>`).join(""):`<div class="empty"><b>${t("empty")}</b><span>${t("emptyHint")}</span></div>`;
  $$("[data-complete]").forEach(el=>el.onclick=()=>openConfirm("complete",state.tasks.find(x=>x.id===el.dataset.complete)));
  $$("[data-actions]").forEach(el=>el.onclick=event=>{event.stopPropagation();openTaskMenu(el,state.tasks.find(x=>x.id===el.dataset.actions));});
  if(state.view==="tasks") initTaskDragging();
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
  const menu=document.createElement("div"); menu.className="action-menu";
  menu.innerHTML=state.view==="tasks"
    ?`<button data-act="urgent">${task.urgent?"☆ בטל דחיפות":"★ סמן כדחוף"}</button><button data-act="edit">✎ ${t("edit")}</button><button data-act="move">↪ ${t("move")}</button><button data-act="delete" class="delete">♲ ${t("delete")}</button>`
    :`<button data-act="restore">↶ ${t("restore")}</button><button data-act="delete" class="delete">♲ ${t("delete")}</button>`;
  anchor.parentElement.append(menu);
  menu.querySelector('[data-act="urgent"]')?.addEventListener("click",()=>{closeMenus();toggleUrgent(task);});
  menu.querySelector('[data-act="edit"]')?.addEventListener("click",()=>openTask(task));
  menu.querySelector('[data-act="move"]')?.addEventListener("click",()=>openMove(task));
  menu.querySelector('[data-act="restore"]')?.addEventListener("click",()=>openConfirm("restore",task));
  menu.querySelector('[data-act="delete"]').onclick=()=>openConfirm("delete",task);
}

function openTask(task=null) {
  closeMenus(); state.editingTask=task;
  const category=state.categories.find(c=>c.id===state.selected);
  if(!category){toast(t("error"));return;}
  $("#taskDialogTitle").textContent=task?t("editTask"):t("newTask");
  $("#taskDialogCategory").textContent=category?.name||"";
  $("#taskText").value=task?.text||""; $("#taskText").placeholder=t("taskPlaceholder"); $("#taskText").dir=isHebrew($("#taskText").value)?"rtl":"ltr";
  resetVoiceInput();
  $("#taskDialog").showModal(); setTimeout(()=>$("#taskText").focus(),50);
}
async function createTask(value){
  const maxOrder=Math.max(0,...state.tasks.filter(x=>x.categoryId===state.selected&&!x.completedAt).map(x=>x.order||0));
  await addDoc(userCollection("tasks"),{text:value,area:state.area,categoryId:state.selected,order:maxOrder+1000,urgent:false,createdAt:serverTimestamp(),completedAt:null});
}

async function saveTask(event) {
  event.preventDefault(); const value=$("#taskText").value.trim(); if(!value)return;
  const saveButton=$("#saveTaskBtn"); saveButton.disabled=true;
  await safe(async()=>{
    if(state.editingTask) await updateDoc(userDoc("tasks",state.editingTask.id),{text:value,updatedAt:serverTimestamp()});
    else await createTask(value);
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
    if(type==="complete"){const categoryId=await historyCategoryId(item);await updateDoc(userDoc("tasks",item.id),{categoryId,completedAt:serverTimestamp()});}
    if(type==="restore")await updateDoc(userDoc("tasks",item.id),{completedAt:null});
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
$("#addTaskTop").onclick=()=>openTask();$("#addTaskFab").onclick=()=>openTask();$("#categoryMenuBtn").onclick=openCategoryMenu;
$("#taskText").oninput=event=>event.target.dir=isHebrew(event.target.value)?"rtl":"ltr";
$("#categoryName").oninput=event=>event.target.dir=isHebrew(event.target.value)?"rtl":"ltr";
$("#taskForm").onsubmit=saveTask;$("#categoryForm").onsubmit=saveCategory;$("#moveForm").onsubmit=moveTask;$("#confirmForm").onsubmit=confirmAction;
$$("[data-close-dialog]").forEach(button=>button.onclick=()=>$("#"+button.dataset.closeDialog).close());
$$("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();}));
document.addEventListener("click",event=>{if(!event.target.closest(".task-actions")&&!event.target.closest("#categoryMenuBtn")&&!event.target.closest("#appMenu"))closeMenus();});
if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js");
render();
