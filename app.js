import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDocs, serverTimestamp, enableIndexedDbPersistence
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
enableIndexedDbPersistence(db).catch(() => {});

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

const state = { user:null, language:localStorage.getItem("tasks-language") || "en", area:"work", view:"tasks", selected:"integration", categories:[], tasks:[], editingTask:null, editingCategory:null, movingTask:null, confirmAction:null, unsubs:[], dragging:false };
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
    if (!state.categories.some(c=>c.id===state.selected&&c.area===state.area)) state.selected=state.categories.find(c=>c.area===state.area)?.id || "";
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
  await safe(async()=>{ await seedCategories(); startSync(); });
});

function selectArea(area) {
  state.area=area;
  state.selected=state.categories.find(c=>c.area===area)?.id || "";
  closeMenus(); render();
}
function closeMenus(){ $(".action-menu,.category-menu").forEach(el=>el.remove()); $("#appMenu").classList.add("hidden"); }

function render() {
  document.documentElement.lang=state.language;
  document.documentElement.dir=state.language==="he"?"rtl":"ltr";
  $$("[data-i18n]").forEach(el=>el.textContent=t(el.dataset.i18n));
  $("#menuLanguageBtn span").textContent=state.language==="en"?"עברית":"English";
  $$("[data-view]").forEach(el=>el.classList.toggle("active",el.dataset.view===state.view));
  $$("[data-area]").forEach(el=>el.classList.toggle("active",el.dataset.area===state.area));
  $("#workCount").textContent=state.tasks.filter(x=>x.area==="work"&&!x.completedAt).length;
  $("#privateCount").textContent=state.tasks.filter(x=>x.area==="private"&&!x.completedAt).length;
  $("#addTaskTop").classList.toggle("hidden",state.view==="history");
  $("#addTaskFab").classList.toggle("hidden",state.view==="history");
  renderCategories(); renderTasks();
}

function renderCategories() {
  const categories=state.categories.filter(c=>c.area===state.area);
  $("#categoryTabs").innerHTML=categories.map(c=>`<button class="category-tab ${c.id===state.selected?"active":""}" data-category="${c.id}">${escapeHtml(c.name)}</button>`).join("")+`<button id="addCategory" class="category-add" aria-label="Add list">＋</button>`;
  $$("[data-category]").forEach(el=>el.onclick=()=>{state.selected=el.dataset.category;closeMenus();render();});
  $("#addCategory").onclick=()=>openCategory();
}

function renderTasks() {
  const category=state.categories.find(c=>c.id===state.selected);
  $("#categoryTitle").textContent=category?.name || "";
  const items=state.tasks.filter(task=>task.area===state.area&&task.categoryId===state.selected&&(state.view==="history"?!!task.completedAt:!task.completedAt)).sort((a,b)=>state.view==="history"?(b.completedAt?.seconds||0)-(a.completedAt?.seconds||0):(a.order??-(a.createdAt?.seconds||0))-(b.order??-(b.createdAt?.seconds||0)));
  $("#taskCount").textContent=`${items.length} ${t("taskCount")}`;
  $("#taskList").innerHTML=items.length?items.map(task=>`
    <article class="task-card ${state.view==="tasks"?"active-task":"history-task"}" data-task-id="${task.id}">
      ${state.view==="tasks"?`<button class="drag-handle" data-drag="${task.id}" aria-label="Drag to reorder">⠿</button>`:""}
      ${state.view==="tasks"?`<button class="complete-btn" data-complete="${task.id}" aria-label="${t("done")}">✓</button>`:`<span class="history-check">✓</span>`}
      <div class="task-copy"><p dir="${isHebrew(task.text)?"rtl":"ltr"}">${escapeHtml(task.text)}</p>${task.completedAt?`<small>${t("completed")} ${formatDate(task.completedAt)}</small>`:""}</div>
      <div class="task-actions"><button class="icon-btn" data-actions="${task.id}" aria-label="Task options">•••</button></div>
    </article>`).join(""):`<div class="empty"><b>${t("empty")}</b><span>${t("emptyHint")}</span></div>`;
  $$("[data-complete]").forEach(el=>el.onclick=()=>openConfirm("complete",state.tasks.find(x=>x.id===el.dataset.complete)));
  $("[data-actions]").forEach(el=>el.onclick=event=>{event.stopPropagation();openTaskMenu(el,state.tasks.find(x=>x.id===el.dataset.actions));});
  if(state.view==="tasks") initTaskDragging();
}

function initTaskDragging(){
  $("[data-drag]").forEach(handle=>handle.onpointerdown=event=>{
    event.preventDefault(); closeMenus();
    const card=handle.closest(".task-card"); state.dragging=true; card.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);
    handle.onpointermove=moveEvent=>{
      if(!state.dragging)return;
      const target=document.elementFromPoint(moveEvent.clientX,moveEvent.clientY)?.closest(".task-card");
      if(!target||target===card||target.parentElement!==card.parentElement)return;
      const box=target.getBoundingClientRect();
      target.parentElement.insertBefore(card,moveEvent.clientY<box.top+box.height/2?target:target.nextSibling);
    };
    handle.onpointerup=async()=>{
      if(!state.dragging)return; state.dragging=false; card.classList.remove("dragging");
      handle.onpointermove=null; handle.onpointerup=null;
      const ids=$("#taskList .task-card").map(el=>el.dataset.taskId);
      await safe(()=>Promise.all(ids.map((id,index)=>updateDoc(userDoc("tasks",id),{order:(index+1)*1000,updatedAt:serverTimestamp()}))));
    };
    handle.onpointercancel=handle.onpointerup;
  });
}

function openTaskMenu(anchor,task) {
  closeMenus();
  const menu=document.createElement("div"); menu.className="action-menu";
  menu.innerHTML=state.view==="tasks"
    ?`<button data-act="edit">✎ ${t("edit")}</button><button data-act="move">↪ ${t("move")}</button><button data-act="delete" class="delete">♲ ${t("delete")}</button>`
    :`<button data-act="restore">↶ ${t("restore")}</button><button data-act="delete" class="delete">♲ ${t("delete")}</button>`;
  anchor.parentElement.append(menu);
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
  $("#taskDialog").showModal(); setTimeout(()=>$("#taskText").focus(),50);
}
async function saveTask(event) {
  event.preventDefault(); const value=$("#taskText").value.trim(); if(!value)return;
  const saveButton=$("#saveTaskBtn"); saveButton.disabled=true;
  await safe(async()=>{
    if(state.editingTask) await updateDoc(userDoc("tasks",state.editingTask.id),{text:value,updatedAt:serverTimestamp()});
    else { const maxOrder=Math.max(0,...state.tasks.filter(x=>x.categoryId===state.selected&&!x.completedAt).map(x=>x.order||0)); await addDoc(userCollection("tasks"),{text:value,area:state.area,categoryId:state.selected,order:maxOrder+1000,createdAt:serverTimestamp(),completedAt:null}); }
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
    if(type==="complete")await updateDoc(userDoc("tasks",item.id),{completedAt:serverTimestamp()});
    if(type==="restore")await updateDoc(userDoc("tasks",item.id),{completedAt:null});
    if(type==="delete")await deleteDoc(userDoc("tasks",item.id));
    if(type==="deleteList"){
      if(state.tasks.some(task=>task.categoryId===item.id)){toast(t("listNotEmpty"));$("#confirmDialog").close();return;}
      await deleteDoc(userDoc("categories",item.id));state.selected=state.categories.find(c=>c.area===state.area&&c.id!==item.id)?.id||"";
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

$("#loginBtn").onclick=login;$("#logoutBtn").onclick=()=>signOut(auth);
$("#menuLanguageBtn").onclick=()=>{state.language=state.language==="en"?"he":"en";localStorage.setItem("tasks-language",state.language);closeMenus();render();};
$(".app-menu-btn").forEach(button=>button.onclick=event=>{event.stopPropagation();const menu=$("#appMenu");const opening=menu.classList.contains("hidden");closeMenus();if(opening){const rect=button.getBoundingClientRect();menu.style.top=`${rect.bottom+6}px`;menu.style.right=`${Math.max(12,innerWidth-rect.right)}px`;menu.classList.remove("hidden");}});
$("[data-menu-view]").forEach(button=>button.onclick=()=>{state.view=button.dataset.menuView;closeMenus();render();});
$$("[data-area]").forEach(el=>el.onclick=()=>selectArea(el.dataset.area));
$("#addTaskTop").onclick=()=>openTask();$("#addTaskFab").onclick=()=>openTask();$("#categoryMenuBtn").onclick=openCategoryMenu;
$("#taskText").oninput=event=>event.target.dir=isHebrew(event.target.value)?"rtl":"ltr";
$("#taskForm").onsubmit=saveTask;$("#categoryForm").onsubmit=saveCategory;$("#moveForm").onsubmit=moveTask;$("#confirmForm").onsubmit=confirmAction;
$("[data-close-dialog]").forEach(button=>button.onclick=()=>$("#"+button.dataset.closeDialog).close());
$("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();}));
document.addEventListener("click",event=>{if(!event.target.closest(".task-actions")&&!event.target.closest("#categoryMenuBtn")&&!event.target.closest("#appMenu"))closeMenus();});
if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js");
render();
