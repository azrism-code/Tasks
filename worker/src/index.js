import webpush from 'web-push';
import { nextOccurrence } from './repeat.js';

const scope='https://www.googleapis.com/auth/datastore';
// A one-minute cron normally finds a task four to five minutes before its due time.
// Delivery remains best effort; late cron runs can produce shorter lead times.
const EARLY_WINDOW_MS=5*60*1000;
const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const pemBytes = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),x=>x.charCodeAt(0));
const base = project => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents`;

async function accessToken(env) {
  const now=Math.floor(Date.now()/1000);
  const header=encode({alg:'RS256',typ:'JWT'});
  const claim=encode({iss:env.GOOGLE_CLIENT_EMAIL,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const content=`${header}.${claim}`;
  const key=await crypto.subtle.importKey('pkcs8',pemBytes(env.GOOGLE_PRIVATE_KEY),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(content));
  const signed=btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${content}.${signed}`});
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body});
  if(!response.ok)throw new Error(`Google token: ${response.status}`);
  return (await response.json()).access_token;
}
function decodeField(field) {
  if(!field)return null;
  if('timestampValue' in field)return field.timestampValue;
  if('stringValue' in field)return field.stringValue;
  if('booleanValue' in field)return field.booleanValue;
  if('integerValue' in field)return Number(field.integerValue);
  if('mapValue' in field)return Object.fromEntries(Object.entries(field.mapValue.fields||{}).map(([k,v])=>[k,decodeField(v)]));
  return null;
}
const firestoreField = value => value === null ? {nullValue:null} : typeof value === 'boolean' ? {booleanValue:value} : {timestampValue:value};
async function jsonRequest(url,token,body) {
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`Firestore ${response.status}: ${await response.text()}`);
  return response.json();
}
async function dueTasks(env,token) {
  const url=`${base(env.FIREBASE_PROJECT_ID)}:runQuery`;
  const cutoff=new Date(Date.now()+EARLY_WINDOW_MS).toISOString();
  const rows=await jsonRequest(url,token,{structuredQuery:{from:[{collectionId:'tasks',allDescendants:true}],
    where:{compositeFilter:{op:'AND',filters:[
      {fieldFilter:{field:{fieldPath:'reminder.enabled'},op:'EQUAL',value:{booleanValue:true}}},
      {fieldFilter:{field:{fieldPath:'reminder.nextTriggerAt'},op:'LESS_THAN_OR_EQUAL',value:{timestampValue:cutoff}}}
    ]}},orderBy:[{field:{fieldPath:'reminder.nextTriggerAt'},direction:'ASCENDING'}],limit:10}});
  return rows.filter(row=>row.document).map(row=>({name:row.document.name,updateTime:row.document.updateTime,
    text:decodeField(row.document.fields.text),reminder:decodeField(row.document.fields.reminder)}));
}
async function subscriptions(env,token,taskName) {
  const owner=taskName.match(/\/users\/([^/]+)\/tasks\/[^/]+$/)?.[1];
  if(!owner)return [];
  const response=await fetch(`${base(env.FIREBASE_PROJECT_ID)}/users/${encodeURIComponent(owner)}/pushSubscriptions?pageSize=30`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error(`Subscriptions: ${response.status}`);
  return ((await response.json()).documents||[]).map(doc=>decodeField(doc.fields.subscription)).filter(Boolean);
}
async function claim(env,token,task,next) {
  const url=`${base(env.FIREBASE_PROJECT_ID)}:commit`;
  const fields={lastTriggeredAt:firestoreField(new Date().toISOString()),nextTriggerAt:firestoreField(next),
    snoozedUntil:firestoreField(null),enabled:firestoreField(!!next)};
  try {
    await jsonRequest(url,token,{writes:[{update:{name:task.name,fields:{reminder:{mapValue:{fields}}}},
      updateMask:{fieldPaths:['reminder.lastTriggeredAt','reminder.nextTriggerAt','reminder.snoozedUntil','reminder.enabled']},
      currentDocument:{updateTime:task.updateTime}}]});
    return true;
  } catch(error) {if(/Firestore 409|Firestore 412/.test(error.message))return false;throw error;}
}
async function scheduled(env) {
  if(!env.FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID==='SET_NEW_PROJECT_ID')throw new Error('FIREBASE_PROJECT_ID is required');
  const token=await accessToken(env);
  const tasks=await dueTasks(env,token);
  webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  for(const task of tasks) {
    const userSubscriptions=await subscriptions(env,token,task.name);
    if(!userSubscriptions.length)continue;
    const next=nextOccurrence(task.reminder,new Date());
    if(!await claim(env,token,task,next))continue;
    const taskId=task.name.split('/').pop();
    const payload=JSON.stringify({taskId,title:task.text||'My Tasks',body:'תזכורת למשימה',level:task.reminder.notificationLevel});
    for(const sub of userSubscriptions) {
      try {await webpush.sendNotification(sub,payload,{TTL:3600});}
      catch(error) {console.error('Push delivery failed',error.statusCode||error.message);}
    }
  }
}
export default {
  async scheduled(_event,env,ctx) {ctx.waitUntil(scheduled(env));},
  fetch() {return new Response('My Tasks reminder worker',{status:200});}
};
