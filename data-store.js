import * as cloud from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Local records live in one atomic snapshot, independent of every Google account.
const LOCAL_KEY="my-tasks-local-data-v1";
const listeners=new Set();
let mode="cloud";
export const getFirestore=cloud.getFirestore;
export const Timestamp=cloud.Timestamp;
export function setStorageMode(value){mode=value==="local"?"local":"cloud";}
function encode(value){
  if(value?.toDate instanceof Function)return {__myTasksDate:value.toDate().toISOString()};
  if(value instanceof Date)return {__myTasksDate:value.toISOString()};
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)]));
  return value;
}
function decode(value){
  if(value?.__myTasksDate)return Timestamp.fromDate(new Date(value.__myTasksDate));
  if(Array.isArray(value))return value.map(decode);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decode(item)]));
  return value;
}
function readLocal(){
  const raw=localStorage.getItem(LOCAL_KEY);
  if(!raw)return {categories:{},tasks:{}};
  try{return decode(JSON.parse(raw));}catch{throw new Error("לא ניתן לקרוא את הנתונים המקומיים. הנתונים נשמרו ללא שינוי.");}
}
function writeLocal(data){
  try{localStorage.setItem(LOCAL_KEY,JSON.stringify(encode(data)));}
  catch{throw new Error("שמירה מקומית נכשלה. בדוק שנותר מקום במכשיר ושהדפדפן מאפשר שמירה.");}
  notify();
}
const localRef=parts=>({__local:true,name:parts.at(-1),path:parts.join("/")});
export const collection=(db,...parts)=>mode==="local"?localRef(parts):cloud.collection(db,...parts);
export const doc=(db,...parts)=>mode==="local"?{...localRef(parts),name:parts.at(-2),id:parts.at(-1)}:cloud.doc(db,...parts);
export const serverTimestamp=()=>mode==="local"?Timestamp.now():cloud.serverTimestamp();
function snapshot(ref,data){return {id:ref.id,exists:()=>data!==undefined,data:()=>data};}
function collectionSnapshot(ref){return {docs:Object.entries(readLocal()[ref.name]||{}).map(([id,data])=>snapshot({id},data))};}
function notify(){setTimeout(()=>{for(const entry of listeners){try{entry.callback(collectionSnapshot(entry.ref));}catch(error){entry.onError?.(error);}}},0);}
if(typeof window!=="undefined")window.addEventListener("storage",event=>{if(event.key===LOCAL_KEY)notify();});
export function onSnapshot(ref,callback,onError){
  if(!ref.__local)return cloud.onSnapshot(ref,callback,onError);
  const entry={ref,callback,onError};listeners.add(entry);
  setTimeout(()=>{if(listeners.has(entry)){try{callback(collectionSnapshot(ref));}catch(error){onError?.(error);}}},0);
  return ()=>listeners.delete(entry);
}
function patchRecord(record,patch){
  for(const [path,value] of Object.entries(patch)){
    const parts=path.split('.');let target=record;
    for(const part of parts.slice(0,-1))target=target[part]??={};
    target[parts.at(-1)]=value;
  }
}
function apply(data,{kind,ref,value,options}){
  const records=data[ref.name]??={};
  if(kind==="delete"){delete records[ref.id];return;}
  if(kind==="update"&&!records[ref.id])throw new Error("הפריט המקומי לא נמצא");
  if(kind==="set"&&!options?.merge)records[ref.id]={...value};
  else {const record=records[ref.id]??={};patchRecord(record,value);}
}
async function mutate(operation){const data=readLocal();apply(data,operation);writeLocal(data);}
export async function addDoc(ref,value){
  if(!ref.__local)return cloud.addDoc(ref,value);
  const id=crypto.randomUUID();await mutate({kind:"set",ref:{...ref,id},value});return {id};
}
export const setDoc=(ref,value,options)=>ref.__local?mutate({kind:"set",ref,value,options}):cloud.setDoc(ref,value,options);
export const updateDoc=(ref,value)=>ref.__local?mutate({kind:"update",ref,value}):cloud.updateDoc(ref,value);
export const deleteDoc=ref=>ref.__local?mutate({kind:"delete",ref}):cloud.deleteDoc(ref);
export function writeBatch(db){
  if(mode!=="local")return cloud.writeBatch(db);
  const operations=[];const batch={};
  for(const kind of ["set","update","delete"])batch[kind]=(ref,value,options)=>{operations.push({kind,ref,value,options});return batch;};
  batch.commit=async()=>{const data=readLocal();for(const operation of operations)apply(data,operation);writeLocal(data);};
  return batch;
}
export async function runTransaction(db,callback){
  if(mode!=="local")return cloud.runTransaction(db,callback);
  const execute=async()=>{
    const data=readLocal(),operations=[];
    const transaction={get:async ref=>snapshot(ref,data[ref.name]?.[ref.id]),update:(ref,value)=>operations.push({kind:"update",ref,value})};
    const result=await callback(transaction);
    if(operations.length){for(const operation of operations)apply(data,operation);writeLocal(data);}
    return result;
  };
  return navigator.locks? navigator.locks.request('my-tasks-local-transaction',execute):execute();
}
