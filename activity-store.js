/* Loja de estado de leitura da Atividade Familiar. Irmã de alerts-store.js,
   mas deliberadamente mais simples: só existe UM estado por item (lido/não
   lido — nunca dispensado/adiado/resolvido, isso pertence só aos Alertas
   financeiros, um conceito diferente). Os próprios itens ("quem fez o quê")
   NÃO são calculados aqui a partir de nenhuma regra — chegam já prontos de
   fora (loadFamilyActivity() em index.html, que os lê do Firestore) e só
   são passados a update(items). Esta loja só decide o que está lido, e por
   quem — sempre um estado individual por utilizador (users/{uid}/
   activityStates), nunca "lido" marcado globalmente para toda a família.
   Ver claude/atividade-familiar.md. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MABActivityStore=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 function create(opts){
  opts = opts || {};
  var uid = opts.uid, repo = opts.repo || null, storage = opts.storage || null;
  var onChange = opts.onChange || function(){};
  var storageKey = 'mab360ActivityV1:' + uid;
  var items = [], readAt = {}, pending = {}, disposed = false, error = '', notifyQueued = false;
  var known = {}, fetching = {}, failed = {}, sending = {};

  try {
    var cache = JSON.parse((storage && storage.getItem(storageKey)) || 'null');
    readAt = (cache && cache.readAt) || {};
    pending = (cache && cache.pending) || {};
  } catch (e) {}

  function persist(){
    try { storage && storage.setItem(storageKey, JSON.stringify({readAt:readAt, pending:pending})); }
    catch (e) { error = 'O estado local não pôde ser guardado neste dispositivo.'; }
  }
  function notify(){
    if (disposed || notifyQueued) return;
    notifyQueued = true;
    Promise.resolve().then(function(){ notifyQueued = false; if (!disposed) onChange(); });
  }

  // Envia à Firestore o estado "lido" ainda por sincronizar — mesmo padrão
  // de fila local + retry de alerts-store.js, para o utilizador nunca
  // perder a marcação de "lido" feita offline (ponto 24 do pedido).
  function flush(){
    if (!repo || disposed) return;
    Object.keys(pending).forEach(function(id){
      if (sending[id] || !known[id]) return;
      var value = pending[id];
      sending[id] = true;
      Promise.resolve().then(function(){ return repo.set(id, value); }).then(function(){
        if (disposed) return;
        if (pending[id] === value) delete pending[id];
        error = ''; persist();
      }).catch(function(){
        if (!disposed) { error = 'Ações guardadas neste dispositivo; a aguardar sincronização.'; persist(); }
      }).finally(function(){
        delete sending[id];
        if (pending[id] && pending[id] !== value) flush();
        notify();
      });
    });
  }

  function hydrate(id){
    if (!repo) { known[id] = true; return; }
    if (known[id] || fetching[id] || failed[id] || disposed) return;
    fetching[id] = true;
    repo.get(id).then(function(record){
      if (disposed) return;
      if (record && record.readAt && !pending[id] && !readAt[id]) readAt[id] = record.readAt;
      known[id] = true; error = ''; persist(); notify();
    }).catch(function(){
      if (!disposed) { failed[id] = true; error = 'A mostrar o estado disponível neste dispositivo.'; notify(); }
    }).finally(function(){ delete fetching[id]; });
  }

  function update(nextItems){
    items = nextItems || [];
    items.forEach(function(a){ hydrate(a.id); });
    notify();
  }

  function model(){
    var list = items.map(function(a){ return Object.assign({}, a, {readAt: readAt[a.id] || null}); });
    var badge = list.filter(function(a){ return !a.readAt; }).length;
    return {items:list, badge:badge, error:error, pending:Object.keys(pending).length};
  }

  function act(id, action){
    if (action !== 'read') return false;
    if (readAt[id]) return true;
    var t = Date.now();
    readAt[id] = t;
    pending[id] = {activityId:id, readAt:t};
    persist(); flush(); hydrate(id); notify();
    return true;
  }

  function retry(){
    if (disposed) return;
    failed = {};
    items.forEach(function(a){ hydrate(a.id); });
    flush();
  }
  function dispose(){ disposed = true; }

  // Estados já em cache local (de uma sessão anterior) não bloqueiam a
  // primeira leitura — mostram-se logo como "lidos" e são confirmados/
  // corrigidos assim que hydrate() os voltar a consultar.
  Object.keys(readAt).forEach(function(id){ known[id] = true; });

  return {update:update, model:model, act:act, retry:retry, dispose:dispose};
 }
 return {create:create};
});
