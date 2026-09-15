/* MAB360 XTB importer. Local XLSX reader, no network/dependencies. */
(function(root){
  'use strict';
  const fail=message=>{throw new Error(message);};
  const number=(v,label)=>{if(v===''||v==null||!Number.isFinite(Number(v)))fail('Valor inválido: '+label);return Number(v);};
  const round=v=>Math.round((v+Number.EPSILON)*100)/100;
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
  const product=v=>v==='Investment Plan'||v==='Investment Plans'?'Investment Plans':v==='My Trades'?'My Trades':fail('Produto XTB não suportado: '+v);
  function timestamp(v){
    let d;
    if(typeof v==='number')d=new Date(Math.round((v-25569)*86400000));
    else {const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(s))fail('Data XTB inválida.');d=new Date(s.replace(' ','T').replace(/Z?$/,'Z'));}
    if(!Number.isFinite(d.getTime()))fail('Data XTB inválida.');return d.toISOString();
  }
  function xml(text){
    if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('XML não permitido.');
    const doc=new root.DOMParser().parseFromString(text,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)fail('XML inválido no Excel.');return doc;
  }
  const tags=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
  async function readWorkbook(input){
    const bytes=new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(bytes.length>5*1024*1024||bytes.length<22)fail('Escolhe um relatório .xlsx até 5 MB.');
    const u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(u32(i)===0x06054b50){end=i;break;}}
    if(end<0||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))fail('Formato ZIP/Excel não suportado.');
    const count=u16(end+10),central=u32(end+16);if(count>150||central>=end)fail('Estrutura Excel inválida.');
    const decoder=new TextDecoder('utf-8',{fatal:true}),files=new Map();let at=central,total=0;
    for(let i=0;i<count;i++){
      if(at+46>end||u32(at)!==0x02014b50)fail('Índice ZIP inválido.');
      const flags=u16(at+8),method=u16(at+10),size=u32(at+20),expanded=u32(at+24),n=u16(at+28),extra=u16(at+30),comment=u16(at+32),offset=u32(at+42);
      if(flags&1||![0,8].includes(method)||at+46+n+extra+comment>end)fail('Excel encriptado ou formato não suportado.');
      const name=decoder.decode(bytes.subarray(at+46,at+46+n));
      if(files.has(name)||name.includes('..')||name.startsWith('/'))fail('Caminho inválido no Excel.');
      total+=expanded;if(total>30*1024*1024)fail('O conteúdo descomprimido excede 30 MB.');
      files.set(name,{method,size,expanded,offset,crc:u32(at+16)});at+=46+n+extra+comment;
    }
    async function read(name,optional){
      const f=files.get(name);if(!f){if(optional)return null;fail('Falta uma parte do Excel: '+name);}
      const o=f.offset;if(o+30>central||u32(o)!==0x04034b50)fail('Entrada ZIP inválida.');
      const start=o+30+u16(o+26)+u16(o+28);if(start+f.size>central)fail('Dados ZIP incompletos.');
      let result=bytes.subarray(start,start+f.size);
      if(f.method===8){
        if(!root.DecompressionStream)fail('Este navegador não suporta a leitura local do Excel. Usa uma versão recente do Chrome ou Edge.');
        let ds;try{ds=new root.DecompressionStream('deflate-raw');}catch(e){fail('Atualiza o navegador para importar ficheiros Excel.');}
        const reader=new Blob([result]).stream().pipeThrough(ds).getReader(),parts=[];let length=0;
        while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>f.expanded||length>30*1024*1024){await reader.cancel();fail('Excel excede o tamanho permitido.');}parts.push(chunk.value);}
        result=new Uint8Array(length);let pos=0;parts.forEach(p=>{result.set(p,pos);pos+=p.length;});
      }
      if(result.length!==f.expanded||crc32(result)!==f.crc)fail('Excel truncado ou corrompido.');return decoder.decode(result);
    }
    const workbook=xml(await read('xl/workbook.xml')),props=tags(workbook,'workbookPr')[0];
    if(props&&['true','1'].includes(props.getAttribute('date1904')))fail('Calendário Excel 1904 não suportado neste formato XTB.');
    const rels=xml(await read('xl/_rels/workbook.xml.rels')),targets=new Map();
    tags(rels,'Relationship').forEach(r=>{if(r.getAttribute('TargetMode')!=='External')targets.set(r.getAttribute('Id'),r.getAttribute('Target'));});
    const shared=await read('xl/sharedStrings.xml',true),strings=shared?tags(xml(shared),'si').map(s=>tags(s,'t').map(t=>t.textContent).join('')):[];
    const sheets={};
    for(const sheet of tags(workbook,'sheet')){
      const name=sheet.getAttribute('name');if(!['Open Positions','Closed Positions','Cash Operations'].includes(name))continue;
      if(sheets[name])fail('Folha duplicada.');
      const id=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),target=targets.get(id);
      if(!target||target.includes('..'))fail('Relação Excel inválida.');
      const path=target.startsWith('/xl/')?target.slice(1):'xl/'+target;
      const doc=xml(await read(path)),rows=[];
      for(const row of tags(doc,'row')){
        if(rows.length>=30000)fail('O relatório excede 30.000 linhas por folha.');
        const values=[];
        for(const cell of tags(row,'c')){
          const match=/^([A-Z]+)[1-9]\d*$/.exec(cell.getAttribute('r')||'');if(!match)fail('Referência Excel inválida.');
          let col=0;for(const c of match[1])col=col*26+c.charCodeAt(0)-64;if(col>100)fail('Demasiadas colunas.');
          if(tags(cell,'f').length)fail('O relatório contém fórmulas. Exporta novamente diretamente da XTB.');
          const type=cell.getAttribute('t'),v=tags(cell,'v')[0];let value=v?v.textContent:'';
          if(type==='s'){if(!/^\d+$/.test(value)||Number(value)>=strings.length)fail('Texto Excel inválido.');value=strings[Number(value)];}
          else if(type==='inlineStr')value=tags(cell,'t').map(t=>t.textContent).join('');
          else if(value!==''&&(!type||type==='n'))value=number(value,'célula');
          values[col-1]=value;
        }
        rows.push(values);
      }
      sheets[name]=rows;
    }
    return sheets;
  }
  function table(rows,first,required){
    const start=rows.findIndex(r=>r[0]===first&&required.every(h=>r.includes(h)));
    if(start<0)fail('Colunas XTB em falta: '+required.join(', '));
    const headers=rows[start];return rows.slice(start+1).filter(r=>r[0]&&r[0]!=='Total'&&r[0]!=='Profit/loss').map((r,i)=>{const o={row:start+i+2};headers.forEach((h,j)=>{if(h)o[h]=r[j]??'';});return o;});
  }
  function parseWorkbook(sheets,filename){
    for(const n of ['Open Positions','Closed Positions','Cash Operations'])if(!sheets[n])fail('Falta a folha '+n+'. Exporta o relatório completo da XTB.');
    const open=sheets['Open Positions'],cash=sheets['Cash Operations'],closed=sheets['Closed Positions'];
    const meta=(rows,key)=>{const r=rows.find(r=>r[0]===key);if(!r)fail('Metadados XTB em falta: '+key);return r[1];};
    const account=String(meta(open,'Account number'));if(!/^\d{1,20}$/.test(account)||String(meta(cash,'Account number'))!==account||String(meta(closed,'Account number'))!==account)fail('Contas inconsistentes no relatório.');
    const asOf=timestamp(meta(open,'Data as of report generated')),from=timestamp(meta(cash,'Date from (UTC)')),to=timestamp(meta(cash,'Date to (UTC)'));
    if(from>to||to>asOf||Date.parse(asOf)>Date.now()+300000)fail('Datas do relatório inconsistentes.');
    const summary=open.filter(r=>r[1]==='Open position value');
    if(!summary.length||summary.some(r=>r[3]!=='EUR'))fail('Nesta versão, importa apenas relatórios de contas EUR.');
    const groups=new Map(),ignored={};
    function group(prod,ticker,name,category){
      prod=product(prod);ticker=String(ticker);
      if(!/^[A-Za-z0-9_.-]{1,40}$/.test(ticker))fail('Ticker inválido.');
      if(category&&!['ETF','STOCK'].includes(category))fail('Apenas ações e ETFs sem alavancagem são suportados.');
      const key='xtb_'+account+'_'+(prod==='My Trades'?'trades':'plans')+'_'+ticker;
      if(!groups.has(key))groups.set(key,{key,account,product:prod,ticker,name:name||ticker,category:category||'',currency:'EUR',quantity:0,value:0,costBasis:0,profit:0,positions:[],events:[],closed:[],asOf,from,to,filename});
      const g=groups.get(key);if(category)g.category=category;if(name)g.name=name;return g;
    }
    const openRows=table(open,'Product',['Instrument/Position','Ticker','Type','Volume','Value','Open time (UTC)','Net Profit']);
    const aggregates=new Set();
    openRows.forEach(r=>{
      const g=group(r.Product,r.Ticker,r.Type?'':r['Instrument/Position'],r.Category);
      if(!r.Type){
        if(aggregates.has(g.key))fail('Resumo de ativo duplicado.');aggregates.add(g.key);
        g.quantity=number(r.Volume,'participações');g.value=number(r.Value,'avaliação');g.profit=number(r['Net Profit'],'resultado');g.costBasis=round(g.value-g.profit);
        if(g.quantity<0||g.value<0||g.costBasis<0)fail('Posição inválida.');
      } else {
        if(r.Type!=='BUY')fail('Posições vendidas a descoberto não são suportadas.');
        const id=String(r['Instrument/Position']).replace(/\.0$/,'');if(!/^\d+$/.test(id))fail('ID de posição inválido.');
        g.positions.push({id,quantity:number(r.Volume,'volume'),value:number(r.Value,'valor'),openPrice:number(r['Open price'],'preço de abertura'),currentPrice:number(r['Current price'],'preço atual'),openedAt:timestamp(r['Open time (UTC)'])});
      }
    });
    const closedRows=table(closed,'Instrument',['Ticker','Category','Volume','Open Time (UTC)','Close Time (UTC)','Purchase Value','Sale Value','Position ID']);
    closedRows.forEach(r=>{
      if(r.Type!=='BUY')fail('Fecho de posição não suportado.');
      const g=group(r.Product,r.Ticker,r.Instrument,r.Category);
      g.closed.push({id:String(r['Position ID']).replace(/\.0$/,''),quantity:number(r.Volume,'volume fechado'),purchaseValue:number(r['Purchase Value'],'custo fechado'),saleValue:number(r['Sale Value'],'venda'),openedAt:timestamp(r['Open Time (UTC)']),closedAt:timestamp(r['Close Time (UTC)'])});
    });
    const eventTypes={'Stock purchase':'purchase','Stock sell':'sale','Dividend':'dividend','Withholding tax':'tax','SEC fee':'fee','Tax IFTT':'fee'};
    const ignoredTypes=['Deposit','Withdrawal','Transfer','Subaccount transfer','Free funds interest','Free funds interest tax'];
    const cashRows=table(cash,'Type',['Ticker','Time','Amount','ID','Comment','Product','Position ID']),ids=new Set();
    cashRows.forEach(r=>{
      const id=String(r.ID).replace(/\.0$/,'');if(!/^\d+$/.test(id)||ids.has(id))fail('ID de operação em falta ou duplicado.');ids.add(id);
      if(ignoredTypes.includes(r.Type)){ignored[r.Type]=(ignored[r.Type]||0)+1;return;}
      const kind=eventTypes[r.Type];if(!kind)fail('Tipo de operação não suportado: '+r.Type);
      if(!r.Ticker)fail('Operação sem ativo: '+r.Type);
      const g=group(r.Product,r.Ticker,r.Instrument,r.Category),at=timestamp(r.Time),cashAmount=number(r.Amount,'montante');
      if(at<from||at>asOf)fail('Operação fora do período.');
      if(kind==='purchase'&&cashAmount>0||kind==='sale'&&cashAmount<0)fail('Sinal inesperado na operação '+id);
      let quantity=null,price=null;
      if(kind==='purchase'||kind==='sale'){
        const match=/^(?:OPEN|CLOSE) BUY ([0-9]+(?:\.[0-9]+)?)(?:\/[0-9]+(?:\.[0-9]+)?)? @ ([0-9]+(?:\.[0-9]+)?)(?:\s|$)/.exec(String(r.Comment));
        if(!match)fail('Não foi possível interpretar as participações da operação '+id);
        quantity=number(match[1],'quantidade');price=number(match[2],'preço');
      }
      g.events.push({id,kind,at,date:at.slice(0,10),amount:-cashAmount,quantity,price,positionId:String(r['Position ID']||'').replace(/\.0$/,'')});
    });
    for(const g of groups.values()){
      g.events.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
      if(!g.category)fail('Categoria em falta para '+g.ticker);
      const quantity=g.events.reduce((n,e)=>n+(e.kind==='purchase'?e.quantity:e.kind==='sale'?-e.quantity:0),0);
      const cost=g.events.filter(e=>e.kind==='purchase').reduce((n,e)=>n+e.amount,0),closedCost=g.closed.reduce((n,c)=>n+c.purchaseValue,0);
      const saleValue=-g.events.filter(e=>e.kind==='sale').reduce((n,e)=>n+e.amount,0),closedSales=g.closed.reduce((n,c)=>n+c.saleValue,0);
      if(Math.abs(quantity-g.quantity)>0.00011)fail('Histórico de participações incompleto em '+g.ticker+'. Importa o período completo.');
      if(Math.abs(cost-closedCost-g.costBasis)>0.15)fail('O custo não coincide com as posições em '+g.ticker+'. Revê o relatório.');
      if(Math.abs(saleValue-closedSales)>0.15)fail('As vendas não coincidem com as posições fechadas em '+g.ticker+'.');
      if(g.quantity>0&&(!g.positions.length||Math.abs(g.positions.reduce((n,p)=>n+p.quantity,0)-g.quantity)>0.00011||Math.abs(g.positions.reduce((n,p)=>n+p.value,0)-g.value)>0.05))fail('As posições detalhadas não coincidem com o resumo de '+g.ticker+'.');
      if(g.events.length>350)fail('O ativo '+g.ticker+' excede 350 operações. Esta versão não o pode importar de forma atómica.');
      g.netFlows=round(g.events.reduce((n,e)=>n+e.amount,0));g.purchases=round(cost);
    }
    summary.forEach(r=>{const actual=Array.from(groups.values()).filter(g=>g.product===product(r[0])).reduce((n,g)=>n+g.value,0);if(Math.abs(actual-number(r[2],'resumo'))>0.05)fail('A soma das avaliações não coincide com o resumo XTB.');});
    return {account,asOf,from,to,groups:Array.from(groups.values()),ignored,operationCount:cashRows.length,total:round(Array.from(groups.values()).reduce((n,g)=>n+g.value,0))};
  }
  function canonical(value){
    if(value==null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  }
  function prepareGroup(g,options,current,signature){
    const id=options.targetId||g.key,inv=current.investment,flows=current.contributions||[],snaps=current.snapshots||[],now=new Date().toISOString();
    if(inv&&inv.archived)fail('O investimento selecionado está arquivado.');
    if(inv&&inv.xtbGroupKey&&inv.xtbGroupKey!==g.key)fail('Este investimento pertence a outra conta, produto ou ticker.');
    const replacing=!!inv&&!inv.xtbGroupKey;
    if(replacing&&!options.replaceManual)fail('Confirma a substituição do histórico manual pela XTB.');
    if(replacing&&flows.some(c=>!c.supersededBy&&c.entryId))fail('Este investimento tem aportes ligados ao Orçamento. Não pode ser substituído automaticamente.');
    if(inv&&inv.xtbGroupKey&&(g.asOf<inv.xtbAsOf||g.from>inv.xtbFrom))fail('O relatório é anterior ou cobre um período mais curto do que a última importação.');
    const live=flows.filter(c=>!c.supersededBy),manual=live.filter(c=>c.importSource!=='xtb');
    if(inv&&inv.xtbGroupKey&&manual.length)fail('Existem aportes manuais neste investimento. Reconcilia-os antes de voltar a importar.');
    if(inv&&inv.xtbGroupKey&&snaps.some(s=>!s.supersededBy&&s.importSource!=='xtb'&&(s.date>g.asOf.slice(0,10)||(s.date===g.asOf.slice(0,10)&&s.createdAt>g.asOf))))fail('Existe uma avaliação manual posterior ao relatório. Exporta um relatório XTB mais recente.');
    const checks=[{collection:'investments',id,expected:inv?canonical(inv):null}],writes=[];
    function check(coll,r){const data={...r};delete data.id;checks.push({collection:coll,id:r.id,expected:canonical(data)});}
    flows.forEach(r=>check('investmentContributions',r));snaps.forEach(r=>check('investmentSnapshots',r));
    if(replacing){
      flows.filter(c=>!c.supersededBy).forEach(c=>{const data={...c,supersededBy:g.key};delete data.id;writes.push({collection:'investmentContributions',id:c.id,data});});
      snaps.filter(c=>!c.supersededBy).forEach(c=>{const data={...c,supersededBy:g.key};delete data.id;writes.push({collection:'investmentSnapshots',id:c.id,data});});
    }
    const byId=new Map(flows.map(c=>[c.id,c])),records=[],incomingIds=new Set();let added=0,duplicates=0;
    for(const e of g.events){
      const rid=g.key+'_cash_'+e.id;incomingIds.add(rid);
      const record={investmentId:id,date:e.date,amount:e.amount,createdAt:e.at,isInitial:false,importSource:'xtb',xtbAccount:g.account,xtbGroupKey:g.key,xtbEventId:e.id,xtbEventType:e.kind,xtbPositionId:e.positionId,quantity:e.quantity,executionPrice:e.price,executionPriceCurrency:'instrument',currency:'EUR'};
      const old=byId.get(rid);
      if(old){const data={...old};delete data.id;if(canonical(data)!==canonical(record))fail('A operação '+e.id+' mudou desde a importação anterior. Não foi sobrescrita.');duplicates++;}
      else {checks.push({collection:'investmentContributions',id:rid,expected:null});writes.push({collection:'investmentContributions',id:rid,data:record});added++;}
      records.push({id:rid,...record});
    }
    if(live.some(c=>c.importSource==='xtb'&&!incomingIds.has(c.id)))fail('O relatório omite operações já importadas. Exporta novamente o histórico completo.');
    const snapshotId=g.key+'_valuation_'+g.asOf.replace(/\D/g,'');
    const snapshot={investmentId:id,date:g.asOf.slice(0,10),value:g.value,createdAt:g.asOf,flowSignature:signature(records),importSource:'xtb',xtbGroupKey:g.key,quantity:g.quantity,costBasis:g.costBasis,currency:'EUR'};
    const previous=snaps.find(s=>s.id===snapshotId);
    if(previous){const data={...previous};delete data.id;if(canonical(data)!==canonical(snapshot))fail('A avaliação mudou para o mesmo instante de relatório.');}
    else {checks.push({collection:'investmentSnapshots',id:snapshotId,expected:null});writes.push({collection:'investmentSnapshots',id:snapshotId,data:snapshot});}
    const parent={...(inv||{}),name:inv?inv.name:g.name+' · XTB …'+g.account.slice(-4)+(g.product==='Investment Plans'?' · Plano':''),type:inv?inv.type:'acoes_etf',institution:'XTB',owner:inv?inv.owner||'':options.owner||'',liquid:inv?inv.liquid!==false:true,archived:false,createdAt:inv&&inv.createdAt||now,xtbGroupKey:g.key,xtbAccount:g.account,xtbProduct:g.product,ticker:g.ticker,currency:'EUR',xtbQuantity:g.quantity,xtbCostBasis:g.costBasis,xtbAsOf:g.asOf,xtbFrom:g.from,xtbPositions:g.positions,xtbClosedPositions:g.closed,xtbImportVersion:1};
    if(writes.length||!inv||canonical(parent)!==canonical(inv))writes.push({collection:'investments',id,data:parent});
    if(writes.length>440||checks.length>850)fail('Demasiados registos para importar este ativo de forma atómica.');
    return {key:g.key,targetId:id,checks,writes,added,duplicates,replaced:replacing?live.length:0,valuationAdded:!previous};
  }
  root.MABXTB={readWorkbook,parseWorkbook,timestamp,round,canonical,prepareGroup};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.MABXTB;
})(typeof window!=='undefined'?window:globalThis);
