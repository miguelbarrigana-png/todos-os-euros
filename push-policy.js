/* Fonte partilhada das preferências e elegibilidade push. Sem escritas financeiras. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MABPushPolicy=factory();})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const defaults={enabled:false,timezone:'Europe/Lisbon',budgetExceeded:true,budgetWarning:true,upcomingExpenses:true,overdueExpenses:true,upcomingLoans:true,overdueLoans:true,savingsGoals:true,savingsReminder:false,emergencyFund:true,weeklySummary:false,monthlySummary:true};
  const labels={budgetExceeded:'Orçamento ultrapassado',budgetWarning:'Categoria perto do limite (90%)',upcomingExpenses:'Despesas próximas',overdueExpenses:'Despesas vencidas',upcomingLoans:'Prestações próximas',overdueLoans:'Prestações vencidas',savingsGoals:'Objetivos atingidos',savingsReminder:'Lembrete de poupança',emergencyFund:'Alterações importantes no fundo de emergência',weeklySummary:'Resumo semanal',monthlySummary:'Resumo mensal'};
  const views=['home','month','movimentos','loan','poupancas'];
  function validTimezone(tz){try{new Intl.DateTimeFormat('en',{timeZone:tz}).format();return typeof tz==='string'&&tz.length<80;}catch{return false;}}
  function preferences(value={}){const p={...defaults};for(const k of Object.keys(defaults)){if(k==='timezone'){if(validTimezone(value[k]))p[k]=value[k];}else if(typeof value[k]==='boolean')p[k]=value[k];}return p;}
  function localTime(now,tz){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:validTimezone(tz)?tz:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,month:`${p.year}-${p.month}`,hour:Number(p.hour)};}
  function addDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function addMonths(month,n){const d=new Date(month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);}
  function dueDate(e){if(!/^\d{4}-\d{2}$/.test(e.monthKey||''))return null;const [y,m]=e.monthKey.split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();return e.monthKey+'-'+String(Math.max(1,Math.min(last,Number(e.dueDay)||1))).padStart(2,'0');}
  function canAccessSpace(uid,familyId,space){if(!space||space.archived)return false;if(space.id===familyId)return true;return space.ownerUserId===uid||(space.visibility!=='privado'&&(!space.memberUids||!space.memberUids.length||space.memberUids.includes(uid)));}
  function effectiveAmount(e){return e.actualAmount!==undefined&&e.actualAmount!==null&&e.actualAmount!==''?Number(e.actualAmount):Number(e.amount)||0;}
  function candidates(input){
    const {familyId,uid,spaces=[],entries=[],payments=[],goals=[],savings=[],budgets={},loanBalances={},emergency={},previous={}}=input;
    const pref=preferences(input.settings),today=input.today,month=today.slice(0,7);if(!pref.enabled)return[];
    const allowed=new Set(spaces.filter(s=>canAccessSpace(uid,familyId,s)).map(s=>s.id));const monthly=new Set(spaces.filter(s=>allowed.has(s.id)&&s.type!=='temporario').map(s=>s.id));
    const result=[];const add=(type,entity,period,body,view,spaceId=familyId,priority=2)=>{if(pref[type]&&allowed.has(spaceId))result.push({type,entityId:entity,period,spaceId,view,priority,body,key:[familyId,spaceId,type,entity,period].join('|'),monthKey:period.slice(0,7)});};
    const byOccurrence=new Map();for(const e of entries){if(allowed.has(e.spaceId||familyId))byOccurrence.set((e.spaceId||familyId)+'|'+e.monthKey+'|'+e.paymentId,e);}
    // Deriva apenas a elegibilidade de modelos ainda não materializados. Nunca cria entries.
    for(const p of payments){const sid=p.spaceId||familyId;if(!allowed.has(sid)||p.archived||p.type!=='recorrente'||p.sourceType)continue;for(const date of [addDays(today,-1),addDays(today,1)]){
      const mk=date.slice(0,7);if(p.startMonth>mk||(p.endMonth&&p.endMonth<mk)||(p.loanId&&loanBalances[p.loanId]<=0.005))continue;
      const key=sid+'|'+mk+'|'+p.id;if(!byOccurrence.has(key))byOccurrence.set(key,{...p,paymentId:p.id,spaceId:sid,monthKey:mk,paid:false});
    }}
    for(const e of byOccurrence.values()){
      const template=payments.find(p=>p.id===e.paymentId);
      if(template&&(template.archived||(template.endMonth&&template.endMonth<e.monthKey)||(template.startMonth&&template.startMonth>e.monthKey)))continue;
      if(e.paid||e.kind==='receita'||e.sourceType||e.sourceAction==='extra_payment'||e.extraPaymentEffect||e.type!=='recorrente')continue;
      if(e.loanId&&loanBalances[e.loanId]<=0.005)continue;
      const date=dueDate(e),sid=e.spaceId||familyId;const tomorrow=date===addDays(today,1),yesterday=date===addDays(today,-1);if(!tomorrow&&!yesterday)continue;
      const type=e.loanId?(tomorrow?'upcomingLoans':'overdueLoans'):(tomorrow?'upcomingExpenses':'overdueExpenses');
      const text=e.loanId?(tomorrow?'Tens uma prestação de crédito prevista para amanhã.':'Uma prestação de crédito continua por confirmar.'):(tomorrow?'Amanhã tens uma despesa recorrente prevista.':'Tens uma despesa recorrente por confirmar.');
      add(type,e.paymentId||e.id,date,text,e.loanId?'loan':'movimentos',sid,tomorrow?2:1);
    }
    const totals={};for(const e of entries){const sid=e.spaceId||familyId;if(!monthly.has(sid)||!e.paid||e.kind==='receita'||e.monthKey!==month)continue;const k=sid+'|'+(e.category||'outros');totals[k]=(totals[k]||0)+effectiveAmount(e);}
    for(const sid of monthly)for(const [category,amount]of Object.entries(budgets[sid]||{})){
      const target=Math.round(Number(amount)*100),spent=Math.round((totals[sid+'|'+category]||0)*100);if(target<=0)continue;
      if(spent>target)add('budgetExceeded',category,month,'Uma categoria ultrapassou o orçamento deste mês.','month',sid,1);
      else if(spent>=target*.9)add('budgetWarning',category,month,'Uma categoria está perto do limite do orçamento.','month',sid,2);
    }
    for(const goal of goals){if(goal.archived)continue;const saved=savings.filter(m=>m.goalId===goal.id).reduce((sum,m)=>sum+(Number(m.amount)||0),0);const target=Number(goal.goalAmount)||0;
      if(target>0&&saved>=target)add('savingsGoals',goal.id,String(target),'Atingiste um objetivo de poupança. Vê o progresso na MAB360.','poupancas',familyId,1);
    }
    if(today.slice(-2)==='15'&&goals.some(g=>!g.archived)&&!savings.some(m=>m.entryId&&m.amount>0&&String(m.date).slice(0,7)===month))add('savingsReminder','savings',month,'Queres reservar algum valor para os teus objetivos este mês?','poupancas',familyId,3);
    const coverage=emergency.coverage,avg=emergency.monthlyAverage;
    if(coverage>=3)add('emergencyFund','coverage',coverage>=6?'6':'3',coverage>=6?'O teu fundo de emergência cobre pelo menos seis meses de despesas essenciais.':'O teu fundo de emergência cobre pelo menos três meses de despesas essenciais.','home',familyId,2);
    if(previous.emergencyAverage>0&&avg>=previous.emergencyAverage*1.2&&avg-previous.emergencyAverage>=100)add('emergencyFund','recommendation',month,'A referência do teu fundo de emergência aumentou. Vê o cálculo atualizado.','home',familyId,2);
    const lastMonth=addMonths(month,-1),hasLast=entries.some(e=>(e.spaceId||familyId)===familyId&&e.monthKey===lastMonth);
    if(today.slice(-2)==='01'&&hasLast)add('monthlySummary','summary',lastMonth,'O mês terminou. Vê como correu o teu orçamento.','month',familyId,3);
    if(new Date(today+'T12:00:00Z').getUTCDay()===1&&entries.some(e=>(e.spaceId||familyId)===familyId&&e.paid&&dueDate(e)>=addDays(today,-7)&&dueDate(e)<today))add('weeklySummary','summary',today,'O teu resumo da semana está disponível. Consulta o orçamento e os próximos pagamentos.','home',familyId,3);
    return result.sort((a,b)=>a.priority-b.priority||a.key.localeCompare(b.key));
  }
  function accepts(binding,data,now=new Date()){
    if(!binding?.enabled||(binding.expiresAt!==undefined&&Number(binding.expiresAt)<=now.getTime())||!data||binding.sessionKey!==data.sessionKey||!views.includes(data.view))return false;
    if(!Number.isFinite(Number(data.expiresAt))||Number(data.expiresAt)<=now.getTime())return false;
    const h=localTime(now,binding.timezone).hour;return h>=8&&h<22;
  }
  return{defaults,labels,views,preferences,validTimezone,localTime,addDays,addMonths,dueDate,canAccessSpace,effectiveAmount,candidates,accepts};
});
