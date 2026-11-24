/* Collega la pagina dell'operazione all'archivio online (Supabase).
   Offre alla pagina la stessa interfaccia che aveva dentro Claude (window.claude.use),
   così index.html resta identico: qui cambiano solo accesso, dati in diretta e allegati. */
(function(){
'use strict';

var cfg = window.GUSMEROLI_CONFIG || {};
var SECCHIO = 'allegati';
var risolvi, pronto = new Promise(function(r){ risolvi = r; });
window.claude = { use: function(nome){ return pronto.then(function(api){ return api[nome] || null; }); } };

var sb = null, utente = null, accessi = [], op = null, ruolo = null;
var cache = {}, urls = {}, caricato = false, primaIscrizione = true;
var ascColl = {}, ascDoc = [];

/* ---------- schermata di accesso ---------- */
function el(tag, attrs){
  var e = document.createElement(tag), k;
  for (k in (attrs || {})) {
    if (attrs[k] == null || attrs[k] === false) continue;
    if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
  }
  Array.prototype.slice.call(arguments, 2).forEach(function(c){
    if (c == null || c === false) return;
    e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return e;
}
var stile = el('style', {},
  '#accesso{position:fixed;inset:0;z-index:50;background:var(--band);color:var(--on-band);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}' +
  '#accesso .box{width:min(400px,100%);display:flex;flex-direction:column;gap:18px}' +
  '#accesso img{height:20px;width:auto;align-self:flex-start}' +
  '#accesso h1{font-family:var(--serif);font-weight:400;font-size:34px;line-height:1.1;margin:8px 0 0}' +
  '#accesso p{margin:0;color:var(--on-band-2);font-size:14px;line-height:1.5}' +
  '#accesso form{display:flex;flex-direction:column;gap:12px}' +
  '#accesso label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--on-band-2);display:flex;flex-direction:column;gap:6px}' +
  '#accesso input{font:inherit;font-size:16px;letter-spacing:0;text-transform:none;padding:11px 12px;border:1px solid var(--band-line);background:transparent;color:var(--on-band);border-radius:2px}' +
  '#accesso button{font:inherit;padding:12px 16px;border:1px solid var(--gold-fill);background:var(--gold-fill);color:#0B1626;cursor:pointer;border-radius:2px}' +
  '#accesso button.piano{background:transparent;color:var(--on-band);border-color:var(--band-line)}' +
  '#accesso button[disabled]{opacity:.6;cursor:default}' +
  '#accesso .msg{min-height:1.4em;color:#E69C91}' +
  '.chi{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--on-band-2);flex-wrap:wrap}' +
  '.chi select,.chi button{font:inherit;font-size:12px;background:transparent;color:var(--on-band);border:1px solid var(--band-line);padding:4px 8px;border-radius:2px;cursor:pointer}' +
  '.chi select option{color:#0F2540}' +
  'footer .esci{font:inherit;background:none;border:0;padding:0;color:var(--ink2);text-decoration:underline;cursor:pointer}');
document.head.appendChild(stile);

function schermo(){
  var vecchio = document.getElementById('accesso');
  if (vecchio) vecchio.remove();
  var box = el('div', { class:'box' }, el('img', { src:'logo-bianco.png', alt:'Gusmeroli' }));
  Array.prototype.slice.call(arguments).forEach(function(c){ if (c) box.appendChild(c); });
  document.body.appendChild(el('div', { id:'accesso' }, box));
}
function togliSchermo(){ var s = document.getElementById('accesso'); if (s) s.remove(); }

function schermoAccesso(messaggio){
  var email = el('input', { id:'acc-email', type:'email', required:true, autocomplete:'username' });
  var pass = el('input', { id:'acc-pass', type:'password', required:true, autocomplete:'current-password' });
  var msg = el('p', { class:'msg', role:'alert' }, messaggio || '');
  var b = el('button', { type:'submit' }, 'Entra');
  var form = el('form', {}, el('label', { for:'acc-email' }, 'Email', email), el('label', { for:'acc-pass' }, 'Password', pass), b, msg);
  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    b.disabled = true; msg.textContent = '';
    sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value }).then(function(r){
      if (r.error || !r.data || !r.data.session) { b.disabled = false; msg.textContent = 'Email o password non corrette.'; return; }
      dopoAccesso(r.data.session);
    }, function(){ b.disabled = false; msg.textContent = 'Connessione non riuscita. Riprova tra poco.'; });
  });
  schermo(el('h1', {}, 'Area riservata'), el('p', {}, 'L’andamento delle operazioni, in tempo reale, per le società proprietarie.'), form);
}
function esci(){ sb.auth.signOut().then(function(){ location.reload(); }, function(){ location.reload(); }); }

/* ---------- dati ---------- */
function errore(e){
  var negato = e && (e.code === '42501' || /row-level security|permission/i.test(e.message || ''));
  return { code: negato ? 'invalid_argument' : 'unavailable', message: (e && e.message) || 'Errore' };
}
function uuid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function idAllegati(){
  var out = [];
  Object.keys(cache).forEach(function(r){
    Object.keys(cache[r]).forEach(function(id){
      var d = cache[r][id] || {};
      if (Array.isArray(d.foto)) d.foto.forEach(function(f){ if (typeof f === 'string') out.push(f); });
      ['allegato', 'file'].forEach(function(k){ if (d[k] && typeof d[k].id === 'string') out.push(d[k].id); });
    });
  });
  return out;
}
function firma(tutti){
  var ids = idAllegati().filter(function(id, i, a){ return a.indexOf(id) === i && (tutti || !urls[id]); });
  if (!ids.length) return Promise.resolve();
  return sb.storage.from(SECCHIO).createSignedUrls(ids.map(function(id){ return op + '/' + id; }), 21600).then(function(r){
    (r.data || []).forEach(function(x, i){ if (x && x.signedUrl) urls[ids[i]] = x.signedUrl; });
  }, function(){});
}
window.__blob = function(id){ return urls[id] || ''; };

function snapDoc(racc, id){
  var d = (cache[racc] || {})[id];
  return { id:id, exists: d !== undefined, data:function(){ return d; }, metadata:{ fromCache:false, hasPendingWrites:false } };
}
function snapColl(racc){
  var c = cache[racc] || {};
  var docs = Object.keys(c).sort().map(function(id){ return snapDoc(racc, id); });
  return { docs:docs, size:docs.length, empty:!docs.length, metadata:{ fromCache:false, hasPendingWrites:false } };
}
function avvisa(racc, id){
  (ascColl[racc] || []).forEach(function(f){ try { f(snapColl(racc)); } catch (e) { console.error(e); } });
  ascDoc.forEach(function(a){ if (a.racc === racc && (id == null || a.id === id)) { try { a.fn(snapDoc(racc, a.id)); } catch (e) { console.error(e); } } });
}
function avvisaTutti(){
  var racc = {};
  Object.keys(ascColl).forEach(function(r){ racc[r] = 1; });
  ascDoc.forEach(function(a){ racc[a.racc] = 1; });
  Object.keys(racc).forEach(function(r){ avvisa(r); });
}
function carica(){
  var nuova = {}, da = 0, PASSO = 1000;
  function pagina(){
    return sb.from('voci').select('raccolta,id,dati').eq('operazione', op).range(da, da + PASSO - 1).then(function(r){
      if (r.error) throw errore(r.error);
      (r.data || []).forEach(function(x){ (nuova[x.raccolta] || (nuova[x.raccolta] = {}))[x.id] = x.dati; });
      if ((r.data || []).length === PASSO) { da += PASSO; return pagina(); }
    });
  }
  return pagina().then(function(){ cache = nuova; return firma(); }).then(function(){ caricato = true; avvisaTutti(); });
}
function applica(racc, id, dati){
  if (!cache[racc]) cache[racc] = {};
  if (dati === undefined) delete cache[racc][id]; else cache[racc][id] = dati;
  return firma().then(function(){ avvisa(racc, id); });
}
function scrivi(racc, id, dati){
  return sb.from('voci').upsert({ operazione:op, raccolta:racc, id:id, dati:dati, aggiornato:new Date().toISOString() }).then(function(r){
    if (r.error) throw errore(r.error);
    return applica(racc, id, dati);
  });
}
function cancella(racc, id){
  return sb.from('voci').delete().match({ operazione:op, raccolta:racc, id:id }).then(function(r){
    if (r.error) throw errore(r.error);
    return applica(racc, id, undefined);
  });
}
function rifDoc(racc, id){
  return {
    id:id, path:racc + '/' + id,
    get:function(){ return Promise.resolve(snapDoc(racc, id)); },
    set:function(d){ return scrivi(racc, id, JSON.parse(JSON.stringify(d))); },
    update:function(d){
      var cur = (cache[racc] || {})[id];
      if (cur === undefined) return Promise.reject({ code:'invalid_argument', message:'Documento inesistente' });
      return scrivi(racc, id, Object.assign({}, cur, JSON.parse(JSON.stringify(d))));
    },
    delete:function(){ return cancella(racc, id); },
    onSnapshot:function(fn){
      var a = { racc:racc, id:id, fn:fn };
      ascDoc.push(a);
      if (caricato) setTimeout(function(){ fn(snapDoc(racc, id)); }, 0);
      return function(){ ascDoc = ascDoc.filter(function(x){ return x !== a; }); };
    }
  };
}
var db = {
  doc:function(path){ var p = String(path).split('/'); return rifDoc(p[0], p[0] === 'op' ? op : p[1]); },
  collection:function(racc){
    return {
      path:racc,
      doc:function(id){ return rifDoc(racc, id || uuid()); },
      add:function(d){ var r = rifDoc(racc, uuid()); return r.set(d).then(function(){ return r; }); },
      get:function(){ return Promise.resolve(snapColl(racc)); },
      onSnapshot:function(fn){
        (ascColl[racc] || (ascColl[racc] = [])).push(fn);
        if (caricato) setTimeout(function(){ fn(snapColl(racc)); }, 0);
        return function(){ ascColl[racc] = (ascColl[racc] || []).filter(function(x){ return x !== fn; }); };
      }
    };
  }
};
var EST = { 'image/jpeg':'.jpg', 'image/png':'.png', 'image/webp':'.webp', 'application/pdf':'.pdf' };
var assets = {
  upload:function(blob, opts){
    var tipo = (opts && opts.type) || blob.type;
    if (!EST[tipo]) return Promise.reject({ code:'unsupported_type', message:'Tipo non accettato' });
    if (blob.size > 20 * 1024 * 1024) return Promise.reject({ code:'too_large', message:'File troppo grande' });
    var id = uuid() + EST[tipo];
    return sb.storage.from(SECCHIO).upload(op + '/' + id, blob, { contentType:tipo, upsert:false }).then(function(r){
      if (r.error) throw errore(r.error);
      return sb.storage.from(SECCHIO).createSignedUrl(op + '/' + id, 21600);
    }).then(function(r){
      if (r.data && r.data.signedUrl) urls[id] = r.data.signedUrl;
      return { id:id, url:urls[id] || '', sizeBytes:blob.size, contentType:tipo };
    });
  },
  delete:function(id){
    return sb.storage.from(SECCHIO).remove([op + '/' + id]).then(function(r){
      if (r.error) throw errore(r.error);
      delete urls[id];
      return { deleted:true };
    });
  }
};

/* ---------- diretta ---------- */
function ascoltaDiretta(){
  sb.channel('voci-' + op)
    .on('postgres_changes', { event:'*', schema:'public', table:'voci', filter:'operazione=eq.' + op }, function(p){
      var riga = p.eventType === 'DELETE' ? p.old : p.new;
      if (!riga || !riga.raccolta || !riga.id) return;
      applica(riga.raccolta, riga.id, p.eventType === 'DELETE' ? undefined : riga.dati);
    })
    .subscribe(function(stato){
      if (stato !== 'SUBSCRIBED') return;
      if (primaIscrizione) { primaIscrizione = false; return; }
      carica().catch(function(){});   /* dopo una caduta di linea si rilegge tutto */
    });
  setInterval(function(){ firma(true).then(avvisaTutti); }, 5 * 3600 * 1000);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden && caricato) carica().catch(function(){}); });
}

/* ---------- avvio ---------- */
function ricorda(v){ try { if (v) localStorage.setItem('gusmeroli-op', v); return localStorage.getItem('gusmeroli-op'); } catch (e) { return null; } }
function intestazione(){
  var top = document.querySelector('.band-top');
  if (!top) return;
  var chi = el('div', { class:'chi' });
  if (accessi.length > 1) {
    var sel = el('select', { 'aria-label':'Operazione' });
    accessi.forEach(function(a){ sel.appendChild(el('option', { value:a.operazione }, a.nome || a.operazione)); });
    sel.value = op;
    sel.addEventListener('change', function(){ ricorda(sel.value); location.reload(); });
    chi.appendChild(sel);
  }
  if (chi.firstChild) top.appendChild(chi);
  /* niente mail né «Esci» in testa: l'uscita resta come collegamento discreto a fondo pagina */
  var piede = document.querySelector('footer');
  if (piede) piede.appendChild(el('button', { class:'esci', type:'button', onclick:esci }, 'Esci'));
}
function dopoAccesso(sessione){
  utente = sessione.user;
  schermo(el('p', {}, 'Carico i dati…'));
  sb.from('accessi').select('operazione,ruolo,nome').then(function(r){
    if (r.error) throw errore(r.error);
    accessi = r.data || [];
    if (!accessi.length) {
      schermo(el('h1', {}, 'Accesso non abilitato'),
        el('p', {}, 'L’indirizzo ' + utente.email + ' non è ancora abbinato a un’operazione. Scrivi a Marco Gusmeroli per farti abilitare.'),
        el('button', { class:'piano', type:'button', onclick:esci }, 'Esci'));
      return;
    }
    var scelta = ricorda();
    var a = accessi.filter(function(x){ return x.operazione === scelta; })[0] || accessi[0];
    op = a.operazione; ruolo = a.ruolo;
    return carica().then(function(){
      ascoltaDiretta();
      intestazione();
      togliSchermo();
      risolvi({ db:db, user:{ canEdit:function(){ return Promise.resolve(ruolo === 'gestore'); }, isOwner:function(){ return Promise.resolve(ruolo === 'gestore'); } },
                assets: ruolo === 'gestore' ? assets : null });
    });
  }).catch(function(){
    schermo(el('h1', {}, 'Dati non raggiungibili'), el('p', {}, 'Non è stato possibile leggere l’archivio. Controlla la connessione e ricarica la pagina.'),
      el('button', { class:'piano', type:'button', onclick:function(){ location.reload(); } }, 'Ricarica'));
  });
}
function avvia(){
  if (!cfg.url || !cfg.chiave || !window.supabase) {
    schermo(el('h1', {}, 'Archivio non collegato'), el('p', {}, 'La web app non è ancora collegata all’archivio online: mancano indirizzo e chiave in config.js.'));
    return;
  }
  sb = window.supabase.createClient(cfg.url, cfg.chiave);
  schermo(el('p', {}, 'Un momento…'));
  sb.auth.getSession().then(function(r){
    var s = r.data && r.data.session;
    if (s) dopoAccesso(s); else schermoAccesso();
  }, function(){ schermoAccesso(); });
}
avvia();
})();
