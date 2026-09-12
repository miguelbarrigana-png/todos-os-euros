/* Complemento do sw.js. IndexedDB independente do cache de shell: sobrevive às atualizações. */
(function(){
'use strict';
const POLICY=self.MABPushPolicy;
function openStore(){return new Promise((resolve,reject)=>{const req=indexedDB.open('mab360-push',1);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function transaction(mode,work){const db=await openStore();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('state',mode),store=tx.objectStore('state');let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Aborted'));work(store,value=>{result=value;});});}finally{db.close();}}
function readBinding(){return transaction('readonly',(s,done)=>{const r=s.get('binding');r.onsuccess=()=>done(r.result||null);});}
async function bind(value){await transaction('readwrite',(s,done)=>{s.put(value,'binding');const cursor=s.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if(String(row.key).startsWith('seen:')&&Number(row.value)<Date.now()-90*86400000)row.delete();row.continue();};done(true);});const notifications=await self.registration.getNotifications();for(const n of notifications)n.close();}
function consume(data){return transaction('readwrite',(store,done)=>{const r=store.get('binding');r.onsuccess=()=>{
  if(!POLICY.accepts(r.result,data)||!/^[a-f0-9]{64}$/.test(data.notificationKey||'')){done(false);return;}
  const key='seen:'+data.notificationKey,check=store.get(key);check.onsuccess=()=>{if(check.result){done(false);return;}store.put(Date.now(),key);done(true);};
};});}
function trusted(source){try{return source&&new URL(source.url).href.startsWith(self.registration.scope);}catch{return false;}}
function routeUrl(data){const url=new URL('index.html',self.registration.scope);url.searchParams.set('mabPush',data.view);if(data.spaceId)url.searchParams.set('pushSpace',data.spaceId);if(/^\d{4}-\d{2}$/.test(data.monthKey||''))url.searchParams.set('pushMonth',data.monthKey);return url.href;}
self.addEventListener('message',event=>{
 if(!trusted(event.source)||!event.data||!event.ports[0])return;
 const {type,binding,data}=event.data;
 const work=async()=>{if(type==='MAB_PUSH_BIND'){
   if(binding!==null&&(!binding||typeof binding.uid!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(binding.sessionKey||'')))throw new Error('binding');
   await bind(binding);return true;
 }if(type==='MAB_PUSH_GET')return readBinding();if(type==='MAB_PUSH_CONSUME')return consume(data);return null;};
 event.waitUntil(work().then(result=>event.ports[0].postMessage({ok:true,result}),()=>event.ports[0].postMessage({ok:false})));
});
// Register BEFORE Firebase imports so only this handler owns clicks for MAB360 notifications.
self.addEventListener('notificationclick',event=>{
 const data=event.notification.data;if(data?.mabPush!=='1')return;event.stopImmediatePropagation();event.notification.close();
 event.waitUntil((async()=>{
  const binding=await readBinding();if(!binding?.enabled||(binding.expiresAt&&binding.expiresAt<=Date.now())||binding.sessionKey!==data.sessionKey||!POLICY.views.includes(data.view))return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=windows.find(w=>w.url.startsWith(self.registration.scope));
  if(client){client.postMessage({type:'MAB_PUSH_NAVIGATE',data});await client.focus();}else await self.clients.openWindow(routeUrl(data));
 })());
});
async function background(payload){const data=payload.data;if(!await consume(data))return;
 // Recheck after the asynchronous claim: logout must take precedence over delivery.
 const binding=await readBinding();if(!POLICY.accepts(binding,data))return;
 await self.registration.showNotification('MAB360',{body:String(data.body||'Tens uma atualização na MAB360.').slice(0,240),icon:new URL('icons/icon-192.png',self.registration.scope).href,badge:new URL('icons/logo-mark.png',self.registration.scope).href,tag:'mab360-'+data.notificationKey,renotify:false,data});
}
try{
 if(self.MAB_PUSH_CONFIG?.vapidKey){
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  firebase.initializeApp(self.MAB_PUSH_CONFIG.firebase);firebase.messaging().onBackgroundMessage(background);
 }
}catch(error){console.warn('MAB360 push indisponível neste arranque.');}
// Exported only in a test VM; no runtime test globals in production.
if(typeof module==='object'&&module.exports)module.exports={consume,bind,readBinding,background,routeUrl};
})();
