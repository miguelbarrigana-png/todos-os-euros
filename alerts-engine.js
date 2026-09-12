/* MAB360: pure alert policy. Monetary calculations are supplied by the existing app. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MABAlerts=api;})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const priorities={important:0,attention:1,info:2};
 const titles={budget_deficit:'Despesas acima da receita prevista',savings_stalled:'Poupança sem movimentos recentes',budget_warning:'Categoria perto do limite',budget_reached:'Orçamento atingido',budget_exceeded:'Orçamento ultrapassado',spending_pace:'Ritmo de despesas elevado',expense_overdue:'Despesa por confirmar',income_overdue:'Receita por confirmar',loan_upcoming:'Prestação próxima',loan_overdue:'Prestação vencida',loan_ending:'Crédito perto do fim',loan_settled:'Crédito liquidado',loan_review:'Revisão de taxa próxima',ef_below:'Reserva abaixo do objetivo',ef_milestone:'Marco do Fundo de Emergência',ef_complete:'Objetivo do fundo atingido',savings_complete:'Objetivo de poupança atingido',savings_behind:'Poupança abaixo do ritmo necessário',savings_due:'Data objetivo próxima',investment_stale:'Valor do investimento por atualizar'};
 const key=(...parts)=>parts.map(v=>encodeURIComponent(String(v??'')).replace(/~/g,'%7E')).join('~');
 const group=(domain,space='',period='')=>key(domain,space,period);
 const milestoneKeys=family=>[1,3,6].map(n=>key(family,'ef_milestone','',String(n),''));
 function buildAlerts(f){
  if(!f?.familyId||!f.uid||!f.ready)return[];
  const out=[],period=f.monthKey,space=f.spaceId,now=f.now;
  function add(type,entityType,entityId,scope,term,priority,message,options={}){
   out.push({key:key(f.familyId,options.keyType||type,scope,entityId,term),familyId:f.familyId,type,priority,title:titles[type],message,entityType,entityId:String(entityId),spaceId:scope||null,monthKey:term||null,group:options.group||group(entityType,scope,term),calculatedAt:now,urgency:options.urgency??99,actionTarget:options.view||'home',actionLabel:options.actionLabel||'Ver detalhe',iconName:options.icon||'bell',pushEligible:!!options.pushEligible,milestone:!!options.milestone,targetSignature:options.targetSignature||''});
  }
  if(f.scopeReady){
   for(const b of f.budgets||[]){
    const bs=b.status;if(!bs||bs.budget<=0)continue;
    const near=Math.round(bs.spent*100)*10>=Math.round(bs.budget*100)*9;
    const type=bs.status==='over'?'budget_exceeded':bs.status==='reached'?'budget_reached':near?'budget_warning':null;
    if(type)add(type,'category',b.id,space,period,type==='budget_exceeded'?'important':'attention',b.name+' — '+(type==='budget_exceeded'?'ultrapassaste o orçamento.':type==='budget_reached'?'atingiste 100% do orçamento.':Math.min(99,bs.percentage)+'% do orçamento utilizado.'),{keyType:'budget',group:group('budget',space,period),view:'month',actionLabel:'Ver categoria',pushEligible:type==='budget_exceeded',icon:'wallet',urgency:20});
   }
   if(f.available < -0.005 && !out.some(a=>a.type==='budget_exceeded'))add('budget_deficit','budget','balance',space,period,'important','As despesas previstas ultrapassam a receita prevista para este período.',{group:group('budget',space,period),view:'month',actionLabel:'Ver orçamento',icon:'wallet',urgency:25});
   if(f.pace?.type==='warning')add('spending_pace','budget','pace',space,period,'attention',f.pace.text,{group:group('budget',space,period),view:'month',actionLabel:'Ver orçamento',urgency:40,icon:'trending'});
   for(const e of f.entries||[]){
    if(e.paid||e.example)continue;
    if(e.loanId){
     if(!e.loanActive||e.extra)continue;
     if(e.overdue)add('loan_overdue','loan',e.loanId,space,e.period,'important',e.name+' continua por confirmar.',{keyType:'loan_payment',group:group('movement',space,period),view:'loan',actionLabel:'Ver crédito',urgency:e.daysUntil,pushEligible:true,icon:'landmark'});
     else if(e.daysUntil>=0&&e.daysUntil<=3)add('loan_upcoming','loan',e.loanId,space,e.period,'attention',e.name+' vence '+(e.daysUntil===0?'hoje':e.daysUntil===1?'amanhã':'dentro de '+e.daysUntil+' dias')+'.',{keyType:'loan_payment',group:group('movement',space,period),view:'loan',actionLabel:'Ver crédito',urgency:e.daysUntil,pushEligible:true,icon:'landmark'});
    }else if(e.overdue)add(e.kind==='receita'?'income_overdue':'expense_overdue','entry',e.id,space,e.period,e.kind==='receita'?'attention':'important',e.name+' continua por confirmar.',{group:group('movement',space,period),view:'movimentos',actionLabel:'Ver movimento',urgency:e.daysUntil,pushEligible:e.kind!=='receita',icon:e.kind==='receita'?'wallet':'alert'});
   }
  }
  if(f.loansReady)for(const l of f.loans||[]){
   if(l.settled)add('loan_settled','loan',l.id,null,null,'info',l.name+' está liquidado.',{group:group('loans'),view:'loan',actionLabel:'Ver crédito',milestone:true,icon:'check'});
   else if(l.monthsToEnd!=null&&l.monthsToEnd>=0&&l.monthsToEnd<=2)add('loan_ending','loan',l.id,null,l.endMonth,'info',l.name+' aproxima-se do fim previsto.',{group:group('loans'),view:'loan',actionLabel:'Ver crédito',icon:'landmark',urgency:60});
   else if(l.review)add('loan_review','loan',l.id,null,l.review,'attention',l.name+' tem uma revisão de taxa próxima.',{group:group('loans'),view:'loan',actionLabel:'Ver crédito',icon:'landmark',urgency:45});
  }
  if(f.savingsReady)for(const s of f.savings||[]){
   const opts={group:group('savings'),view:'poupancas',actionLabel:'Ver objetivo',icon:'piggy',keyType:'savings_goal',targetSignature:String(s.goalAmount||'')};
   if(s.complete)add('savings_complete','savings',s.id,null,String(s.goalAmount),'info',s.name+' atingiu o objetivo.',{...opts,milestone:true,pushEligible:true});
   else if(s.target?.status==='overdue'||s.pace?.pace==='behind')add('savings_behind','savings',s.id,null,s.target?.targetDate||period,'attention',s.name+' precisa de atenção para chegar à meta.',{...opts,urgency:30});
   else if(s.target&&s.target.monthsRemaining>=0&&s.target.monthsRemaining<=1)add('savings_due','savings',s.id,null,s.target.targetDate,'attention',s.name+' aproxima-se da data objetivo.',{...opts,urgency:35});
   else if(s.stalled)add('savings_stalled','savings',s.id,null,f.todayMonth,'info',s.name+' não tem movimentos há mais de dois meses.',opts);
  }
  const ef=f.emergency;
  if(f.emergencyReady&&ef?.goal){
   const signature=ef.signature;
   if(ef.targetAmount>0&&ef.current<ef.targetAmount)add('ef_below','emergency','fund',null,f.todayMonth,'attention','A reserva está abaixo do objetivo que definiste.',{group:group('emergency'),view:'home',actionLabel:'Ver fundo',icon:'shield',urgency:70});
   if(ef.targetAmount>0&&ef.current>=ef.targetAmount)add('ef_complete','emergency','target',null,signature,'info','A tua reserva atingiu o objetivo definido.',{group:group('emergency'),view:'home',actionLabel:'Ver fundo',icon:'check',milestone:true,pushEligible:true});
   const n=ef.monthsCovered>=6?6:ef.monthsCovered>=3?3:ef.monthsCovered>=1?1:0;
   if(n && !(ef.targetAmount>0&&ef.current>=ef.targetAmount))add('ef_milestone','emergency',String(n),null,null,'info','A reserva cobre pelo menos '+n+(n===1?' mês.':' meses.'),{group:group('emergency'),view:'home',actionLabel:'Ver fundo',icon:'shield',milestone:true,pushEligible:n>=3});
  }
  if(f.investmentsReady)for(const i of f.investments||[])if(i.stale)add('investment_stale','investment',i.id,null,i.lastUpdate,'attention',i.name+' está há mais de 90 dias sem atualização de valor.',{group:group('investments'),view:'investment',actionLabel:'Ver investimento',icon:'trending',urgency:80});
  // One key is one condition. Priorities/urgency order is independent of presentation.
  return [...new Map(out.map(a=>[a.key,a])).values()].sort(compare);
 }
 function compare(a,b){return priorities[a.priority]-priorities[b.priority]||(a.urgency??99)-(b.urgency??99)||(b.calculatedAt||0)-(a.calculatedAt||0)||a.key.localeCompare(b.key);}
 function descriptor(a,now){return{key:a.key,familyId:a.familyId,type:a.type,entityType:a.entityType,entityId:a.entityId,spaceId:a.spaceId,monthKey:a.monthKey,group:a.group,milestone:a.milestone,observedAt:now,updatedAt:now,readAt:null,dismissedAt:null,snoozedUntil:null,resolvedAt:null};}
 function visible(record,f){return record.familyId===f.familyId&&(!record.spaceId||f.allowedSpaces.includes(record.spaceId));}
 function active(a,r,now){return !r?.dismissedAt&&!(r?.snoozedUntil>now)&&!r?.resolvedAt;}
 function suppressedMilestone(a,records){return a.type==='ef_milestone'&&Object.values(records).some(r=>r.familyId===a.familyId&&r.type==='ef_milestone'&&Number(r.entityId)>Number(a.entityId));}
 return{buildAlerts,key,group,milestoneKeys,compare,descriptor,visible,active,suppressedMilestone,titles,priorities};
});
