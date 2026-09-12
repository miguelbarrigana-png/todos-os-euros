/* Per-user state and lifecycle; no financial rules or HTML. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./alerts-engine'));else root.MABAlertStore=factory(root.MABAlerts);})(typeof self!=='undefined'?self:this,function(E){
 'use strict';
 function create({uid,familyId,repo=null,storage=null,onChange=()=>{},now=()=>Date.now()}){
  const storageKey='mab360AlertsV1:'+uid+':'+familyId,DAY=86400000;
  let records={},pending={},facts=null,candidates=[],disposed=false,error='',notifyQueued=false;
  const known=new Set(),fetching=new Set(),failed=new Set(),sending=new Set();let unsubscribe=null;
  try{const cache=JSON.parse(storage?.getItem(storageKey)||'null');records=cache?.records||{};pending=cache?.pending||{};}catch{}
  // Local records contain only identifiers and personal actions, never messages or amounts.
  function persist(){try{storage?.setItem(storageKey,JSON.stringify({records,pending}));}catch{error='O estado local não pôde ser guardado neste dispositivo.';}}
  function notify(){if(disposed||notifyQueued)return;notifyQueued=true;Promise.resolve().then(()=>{notifyQueued=false;if(!disposed)onChange();});}
  function flush(){if(!repo||disposed)return;for(const [key,value] of Object.entries(pending)){
   if(sending.has(key)||!known.has(key))continue;sending.add(key);
   Promise.resolve().then(()=>repo.set(key,value)).then(()=>{if(disposed)return;if(pending[key]===value)delete pending[key];error='';persist();}).catch(()=>{if(!disposed){error='As ações estão guardadas neste dispositivo e aguardam sincronização. Confirma a ligação e as regras de alertas.';persist();}}).finally(()=>{sending.delete(key);if(pending[key]&&pending[key]!==value)flush();notify();});
  }}
  function put(record){records[record.key]=record;pending[record.key]=record;persist();flush();}
  function merge(record){if(!record?.key||record.familyId!==familyId)return;known.add(record.key);if(!pending[record.key]&&(!records[record.key]||record.updatedAt>=records[record.key].updatedAt))records[record.key]=record;}
  function hydrate(key){if(!repo){known.add(key);return;}if(known.has(key)||fetching.has(key)||failed.has(key)||disposed)return;fetching.add(key);
   repo.get(key).then(record=>{if(disposed)return;if(record)merge(record);known.add(key);error='';persist();reconcile();flush();notify();}).catch(()=>{if(!disposed){failed.add(key);error='A mostrar o estado disponível neste dispositivo. A sincronização será retomada quando for possível.';notify();}}).finally(()=>fetching.delete(key));
  }
  function reconcile(){
   if(disposed||!facts?.ready)return;
   const time=now();const keys=new Set(candidates.map(a=>a.key));
   for(const a of candidates){
    if(!known.has(a.key)&&!records[a.key]&&repo)continue;
    if(E.suppressedMilestone(a,records))continue;
    if(a.type==='ef_milestone'&&!records[a.key]&&repo&&!E.milestoneKeys(familyId).every(k=>known.has(k)))continue;
    let r=records[a.key];
    if(!r){put(E.descriptor(a,time));continue;}
    if(r.type!==a.type||r.resolvedAt){
     const oldPriority=r.type==='budget_exceeded'||r.type==='loan_overdue'?0:r.type==='budget_warning'||r.type==='budget_reached'||r.type==='loan_upcoming'?1:2;
     put({...r,type:a.type,resolvedAt:null,updatedAt:time,readAt:E.priorities[a.priority]<oldPriority&&!r.dismissedAt?null:r.readAt});
    }
   }
   for(const r of Object.values(records))if(E.visible(r,facts)&&facts.evaluatedGroups.includes(r.group)&&!keys.has(r.key)&&!r.resolvedAt)put({...r,resolvedAt:time,updatedAt:time});
   // Bound local non-milestone history; persistent markers remain available by exact key.
   const old=Object.values(records).filter(r=>!r.milestone&&!pending[r.key]&&r.updatedAt<time-90*DAY).sort((a,b)=>a.updatedAt-b.updatedAt);
   if(Object.keys(records).length>400){old.slice(0,Object.keys(records).length-400).forEach(r=>delete records[r.key]);persist();}
  }
  function update(next){facts=next;candidates=E.buildAlerts(next);if(next.ready){
   const hydrateList=candidates.map(a=>a.key).concat(next.emergencyReady?E.milestoneKeys(familyId):[]);
   // Verify higher milestones before making a lower one visible, including after history expiry.
   hydrateList.forEach(hydrate);reconcile();
  }}
  function model(){
   if(!facts?.ready)return{active:[],all:[],badge:0,error,pending:Object.keys(pending).length};
   const time=now(),current=[];
   for(const a of candidates){
    if(!E.visible(a,facts)||E.suppressedMilestone(a,records))continue;
    if(repo&&!known.has(a.key)&&!records[a.key])continue;
    if(a.type==='ef_milestone'&&!records[a.key]&&repo&&!E.milestoneKeys(familyId).every(k=>known.has(k)))continue;
    if(a.milestone&&records[a.key]?.observedAt<time-90*DAY)continue;
    current.push({...a,state:records[a.key]||E.descriptor(a,time)});
   }
   const active=current.filter(a=>E.active(a,a.state,time));
   const present=new Set(current.map(a=>a.key));
   const history=Object.values(records).filter(r=>E.visible(r,facts)&&!present.has(r.key)&&r.updatedAt>=time-90*DAY).map(r=>({key:r.key,type:r.type,title:E.titles[r.type]||'Alerta anterior',message:r.resolvedAt?'A condição deixou de se verificar na última avaliação.':'Este contexto ainda não foi reavaliado. Abre o Space e período correspondentes.',priority:'info',iconName:'bell',spaceId:r.spaceId,monthKey:r.monthKey,state:r,historical:true}));
   return{active,all:[...current,...history].sort((a,b)=>(b.state.updatedAt||0)-(a.state.updatedAt||0)).slice(0,200),badge:active.filter(a=>!a.state.readAt).length,error,pending:Object.keys(pending).length};
  }
  function act(key,action,days){
   if(!facts?.ready)return false;
   const a=candidates.find(a=>a.key===key),r=records[key]||(a?E.descriptor(a,now()):null);
   if(!r||!E.visible(r,facts))return false;
   const next={...r,updatedAt:now()};
   if(action==='read')next.readAt=now();
   else if(action==='dismiss')next.dismissedAt=now();
   else if(action==='snooze'&&[1,3,7].includes(days)){const until=new Date(now());until.setDate(until.getDate()+days);until.setHours(9,0,0,0);next.snoozedUntil=until.getTime();next.readAt=null;}
   else return false;
   put(next);hydrate(key);notify();return true;
  }
  function retry(){if(disposed)return;failed.clear();if(facts)update(facts);flush();}
  function dispose(){disposed=true;if(unsubscribe)unsubscribe();}
  if(repo){unsubscribe=repo.subscribe(list=>{if(disposed)return;list.forEach(merge);persist();if(facts)update(facts);flush();notify();},()=>{if(disposed)return;error='Não foi possível sincronizar o estado dos alertas. A versão local continua disponível.';notify();});}
  else Object.keys(records).forEach(k=>known.add(k));
  return{update,model,act,retry,dispose,records:()=>records,pending:()=>pending};
 }
 return{create};
});
