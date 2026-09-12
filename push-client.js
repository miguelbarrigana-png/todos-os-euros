/* Integração opcional, isolada das contas. Carregada pelo módulo Firebase existente. */
export async function createPushClient({app,auth,firestore,api,functionsApi,config,policy,notify,navigate}){
 const {doc,getDoc,setDoc,serverTimestamp}=api;
 const calls=functionsApi.getFunctions(app,config.functionsRegion);
 const call=(name,data)=>functionsApi.httpsCallable(calls,name)(data).then(r=>r.data);
 const key='mab360PushDeviceV1';let local;try{local=JSON.parse(localStorage.getItem(key)||'null');}catch{}
 if(!local?.deviceId)local={deviceId:crypto.randomUUID(),enabled:false,uid:null,sessionKey:null};
 let user=null,prefs=policy.preferences(),busy=false,error='',sdk=null,messaging=null,unsubscribe=null,generation=0,lastRefresh=0;
 const overlay=document.getElementById('pushSettingsOverlay'),body=document.getElementById('pushSettingsBody');
 function sessionExpiry(){return (Number(localStorage.getItem('contasEmDiaLoginAt'))||0)+7*86400000;}
 function persist(){localStorage.setItem(key,JSON.stringify(local));}
 function registration(){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('sw-unavailable')),8000);navigator.serviceWorker.ready.then(r=>{clearTimeout(timer);resolve(r);},e=>{clearTimeout(timer);reject(e);});});}
 async function worker(type,extra={}){const reg=await registration();return new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>reject(new Error('sw-timeout')),5000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data.ok?resolve(e.data.result):reject(new Error('sw-error'));};reg.active.postMessage({type,...extra},[channel.port2]);});}
 function support(){const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);if(ios&&!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone)return 'No iPhone/iPad, instala a MAB360 no ecrã principal e abre-a a partir daí. Requer iOS/iPadOS 16.4 ou posterior.';if(!isSecureContext||!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))return 'Este browser não suporta as notificações da MAB360.';if(!config.vapidKey)return 'As notificações ainda não estão disponíveis nesta versão instalada.';return '';}
 async function loadMessaging(){if(!sdk){sdk=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js');if(!await sdk.isSupported())throw new Error('unsupported');messaging=sdk.getMessaging(app);unsubscribe=sdk.onMessage(messaging,async payload=>{
   try{if(!user||!local.enabled||!prefs.enabled||local.uid!==user.uid||!await worker('MAB_PUSH_CONSUME',{data:payload.data}))return;if(user&&local.enabled&&local.sessionKey===payload.data.sessionKey)notify(payload.data.body,()=>{if(user&&local.enabled&&local.sessionKey===payload.data.sessionKey)navigate(payload.data);});}catch{}
 });}return messaging;}
 async function sync({optIn=false}={}){
  const uid=user?.uid,run=generation;if(!uid||!local.enabled||local.uid!==uid||Notification.permission!=='granted')return;
  await loadMessaging();const reg=await registration();if(Notification.permission!=='granted')throw new Error('permission-changed');const token=await sdk.getToken(messaging,{vapidKey:config.vapidKey,serviceWorkerRegistration:reg});
  if(!token)throw new Error('no-token');if(run!==generation||user?.uid!==uid||!local.enabled)return;
  await call('mabPushRegister',{deviceId:local.deviceId,sessionKey:local.sessionKey,fcmToken:token,sessionExpiresAt:sessionExpiry(),platform:/Android/.test(navigator.userAgent)?'android':(/iPhone|iPad/.test(navigator.userAgent)?'ios':'web'),optIn});
  if(run!==generation||user?.uid!==uid||!local.enabled)return;
  await worker('MAB_PUSH_BIND',{binding:{uid,sessionKey:local.sessionKey,enabled:prefs.enabled,expiresAt:sessionExpiry(),timezone:prefs.timezone}});lastRefresh=Date.now();
 }
 async function suspend(){generation++;const needsClear=local.enabled||local.sessionKey||local.needsClear;local.enabled=false;local.sessionKey=null;local.needsClear=!!needsClear;persist();if(needsClear&&'serviceWorker'in navigator){await worker('MAB_PUSH_BIND',{binding:null});local.needsClear=false;persist();}}
 async function disable(){const uid=user?.uid;await suspend();if(uid){try{await call('mabPushUnregister',{deviceId:local.deviceId});}catch{error='Desativado neste dispositivo. A remoção do registo remoto será repetida no próximo início de sessão.';}}
  if(sdk&&messaging){try{await sdk.deleteToken(messaging);}catch{}}
 }
 function render(){if(!body)return;const unavailable=support(),blocked=('Notification'in window)&&Notification.permission==='denied';const active=!!(user&&local.enabled&&local.uid===user.uid&&prefs.enabled);
  body.replaceChildren();const text=document.createElement('p');text.className='hint';text.textContent=unavailable||(blocked?'Notificações bloqueadas no browser. Podes ativá-las nas definições do dispositivo.':'Recebe apenas alertas úteis, sem valores financeiros nas notificações. Horário: 08:00–22:00.');body.append(text);
  const button=document.createElement('button');button.type='button';button.className='btn primary';button.textContent=busy?'A guardar…':(active?'Desativar neste dispositivo':'Ativar notificações');button.disabled=busy||!user||(!active&&!!(unavailable||blocked));button.addEventListener('click',()=>active?run(disable):enable());body.append(button);
  const scope=document.createElement('p');scope.className='hint';scope.textContent='A ativação é por dispositivo. As categorias abaixo são pessoais e aplicam-se aos teus dispositivos ativos.';body.append(scope);
  if(active){for(const [name,label]of Object.entries(policy.labels)){const row=document.createElement('label');row.className='checkbox-row';row.style.marginBottom='8px';const input=document.createElement('input');input.type='checkbox';input.checked=prefs[name];input.disabled=busy;input.addEventListener('change',()=>run(async()=>{const next={...prefs,[name]:input.checked};await save(next);prefs=next;}));row.append(input,document.createTextNode(label));body.append(row);}
   const tzLabel=document.createElement('label');tzLabel.textContent='Fuso horário';const tz=document.createElement('input');tz.value=prefs.timezone;tz.setAttribute('aria-label','Fuso horário IANA');tz.placeholder='Europe/Lisbon';tz.addEventListener('change',()=>run(async()=>{if(!policy.validTimezone(tz.value))throw new Error('timezone');const next={...prefs,timezone:tz.value};await save(next);prefs=next;await worker('MAB_PUSH_BIND',{binding:{uid:user.uid,sessionKey:local.sessionKey,enabled:true,expiresAt:sessionExpiry(),timezone:prefs.timezone}});}));body.append(tzLabel,tz);
   const test=document.createElement('button');test.type='button';test.className='btn ghost';test.textContent='Enviar teste aos meus dispositivos';test.disabled=busy;test.addEventListener('click',()=>run(async()=>{const result=await call('mabPushTest',{});error=result.attempted?'Teste aceite para envio. Verifica os dispositivos.':'Não enviado: horário de silêncio, limite diário ou teste já pedido hoje.';}));body.append(test);
  }
  if(error){const msg=document.createElement('p');msg.className='hint';msg.setAttribute('role','status');msg.textContent=error;body.append(msg);}
 }
 async function save(next){if(!user)throw new Error('signed-out');await setDoc(doc(firestore,'users',user.uid,'notificationSettings','main'),{...next,updatedAt:serverTimestamp()});}
 async function run(fn){if(busy)return;busy=true;error='';render();try{await fn();}catch{error='Não foi possível concluir. Verifica a ligação e tenta novamente.';}finally{busy=false;render();}}
 function enable(){if(busy||support()||!user)return;
  // This is the ONLY permission request, reached directly by the user's click (before any await).
  const permission=Notification.permission==='granted'?Promise.resolve('granted'):(Notification.permission==='denied'?Promise.resolve('denied'):Notification.requestPermission());
  return run(async()=>{if(await permission!=='granted')return;local.uid=user.uid;local.sessionKey=crypto.randomUUID();local.enabled=true;persist();prefs={...prefs,enabled:true};
   try{await sync({optIn:true});}catch(e){await suspend();throw e;}
  });
 }
 async function session(next){generation++;const previousUid=user?.uid;user=next;error='';
  if(!next||local.uid!==next.uid){await suspend();if(previousUid&&next?.uid!==previousUid){/* old ownership also gets replaced atomically by register */}if(sdk&&messaging)try{await sdk.deleteToken(messaging);}catch{}local.uid=next?.uid||null;persist();}
  if(next){const snapshot=await getDoc(doc(firestore,'users',next.uid,'notificationSettings','main'));if(user?.uid!==next.uid)return;prefs=policy.preferences(snapshot.data());
    if(local.enabled&&prefs.enabled&&!support()&&Notification.permission==='granted')await sync();
    else{if(local.enabled||local.needsClear)await suspend();if(!local.enabled)try{await call('mabPushUnregister',{deviceId:local.deviceId});}catch{}}
  }render();
 }
 document.getElementById('openPushSettings').addEventListener('click',()=>{document.getElementById('settingsOverlay').classList.remove('open');overlay.classList.add('open');render();document.getElementById('closePushSettings').focus();});
 function close(){overlay.classList.remove('open');document.getElementById('settingsOverlay').classList.add('open');document.getElementById('openPushSettings').focus();}
 document.getElementById('closePushSettings').addEventListener('click',close);
 overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
 navigator.serviceWorker?.addEventListener('message',async e=>{if(e.data?.type==='MAB_PUSH_NAVIGATE'&&user&&local.enabled&&e.data.data.sessionKey===local.sessionKey)navigate(e.data.data);});
 window.addEventListener('storage',e=>{if(e.key===key){try{local=JSON.parse(e.newValue)||{deviceId:crypto.randomUUID(),enabled:false};}catch{}render();}});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&local.enabled&&user&&Date.now()-lastRefresh>86400000)run(async()=>{if(Notification.permission!=='granted'){await disable();return;}await session(user);});});
 return{session,logout:disable,render};
}
