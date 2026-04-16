// ═══ ACG subsystem-index renderer ═══
// Each subsystem's /{sub}/index.html calls renderSection({sub, glyph, name})
// and this module fetches ./udts.json, ./tags.json, and /db/tags.json, then
// paints a self-contained view.  Pages talk to each other across the
// BroadcastChannel('acg-mesh') bus so the live feed shows activity from
// sibling subsystem pages in real time.

import {bridge} from '../sandbox/shared/mesh-bridge.js';

// Canonical nav order — every subsystem index links to every other.
export const SUBSYSTEMS=[
  {sub:'chat',    glyph:'💬', name:'chat'},
  {sub:'auth',    glyph:'🔑', name:'auth'},
  {sub:'errors',  glyph:'⚠',  name:'errors'},
  {sub:'scada',   glyph:'🖥️', name:'scada'},
  {sub:'sandbox', glyph:'🧪', name:'sandbox'},
  {sub:'db',      glyph:'🗄️', name:'db'},
];

const SHELL_LINKS=[
  {href:'../',               label:'⚒ mesh'},
  {href:'../gateway-log.html',label:'⚠ log'},
  {href:'../health.html',     label:'⚕ health'},
  {href:'../#scada',          label:'🖥️ scada drawer'},
];

const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmtTs=ts=>ts?new Date(ts).toLocaleTimeString():'—';

async function fetchJson(url){
  const r=await fetch(url,{cache:'no-store'});
  if(!r.ok)throw new Error(url+' → HTTP '+r.status);
  return r.json();
}

function el(tag,attrs={},children=[]){
  const node=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs)){
    if(k==='class')node.className=v;
    else if(k==='html')node.innerHTML=v;
    else node.setAttribute(k,v);
  }
  for(const c of[].concat(children||[]))if(c!=null)node.append(c.nodeType?c:document.createTextNode(c));
  return node;
}

// ─── header + nav ───

function buildHeader(root,{sub,glyph,name,desc}){
  const hd=el('header',{class:'ix-hd'},[
    el('h1',{class:'ix-logo'},[glyph+' '+name, el('span',{},' · ACG subsystem')]),
    ...SHELL_LINKS.map(l=>el('a',{class:'ix-shell',href:l.href},l.label)),
  ]);
  root.append(hd);
  if(desc)root.append(el('p',{class:'ix-lede'},desc));

  const nav=el('nav',{class:'ix-nav'},
    SUBSYSTEMS.map(s=>el('a',{
      class:'ix-pill'+(s.sub===sub?' on':''),
      href:`../${s.sub}/`,
    },[s.glyph+' '+s.name]))
  );
  root.append(nav);
}

// ─── UDT table ───

function buildUdts(root,udts){
  const sec=el('section',{class:'ix-sec'});
  sec.append(el('h2',{},'🏗️ UDTs'));
  if(!udts||!udts.types||!Object.keys(udts.types).length){
    sec.append(el('p',{class:'ix-muted'},'no UDTs declared'));
    root.append(sec);return;
  }
  for(const[name,def]of Object.entries(udts.types)){
    const card=el('div',{class:'ix-card'});
    card.append(el('h3',{},[def.glyph?def.glyph+' ':'',name]));
    if(def.desc)card.append(el('p',{class:'ix-muted'},def.desc));
    const tbl=el('table',{class:'ix-tbl'});
    tbl.append(el('thead',{html:'<tr><th>field</th><th>type</th></tr>'}));
    const tb=el('tbody');
    const fields=Array.isArray(def.fields)
      ?def.fields.map(f=>[f,'any'])
      :Object.entries(def.fields||{});
    for(const[f,t]of fields){
      tb.append(el('tr',{html:`<td>${esc(f)}</td><td><code>${esc(t)}</code></td>`}));
    }
    tbl.append(tb);card.append(tbl);sec.append(card);
  }
  root.append(sec);
}

// ─── Tag catalog + live snapshot ───

function getLive(db,path){
  // path = "a.b.c" → db.a.b.c
  const parts=path.split('.');let x=db;
  for(const p of parts){if(x==null)return null;x=x[p]}
  return x&&x.value!==undefined?x:null;
}

function qDot(q){return({good:'🟢',stale:'🟡',bad:'🔴',uncertain:'⚪'})[q]||'⚪'}

function buildTags(root,tags,liveDb){
  const sec=el('section',{class:'ix-sec'});
  sec.append(el('h2',{},'🏷️ Tags'));
  if(!tags||!tags.tags||!tags.tags.length){
    sec.append(el('p',{class:'ix-muted'},'no tags declared'));
    root.append(sec);return;
  }
  const tbl=el('table',{class:'ix-tbl'});
  tbl.append(el('thead',{html:
    '<tr><th>path</th><th>type</th><th>value</th><th>quality</th><th>updated</th></tr>'}));
  const tb=el('tbody');
  for(const t of tags.tags){
    const path=t.path||t.pathPattern||'?';
    const live=t.path?getLive(liveDb||{},t.path):null;
    const val=live?(typeof live.value==='object'?JSON.stringify(live.value):String(live.value)):(t.cardinality==='many'?'<pattern>':'—');
    const quality=live?live.quality:(t.cardinality==='many'?'—':'uncertain');
    const updated=live?fmtTs(live.ts):'—';
    tb.append(el('tr',{html:
      `<td><code>${esc(path)}</code></td>`+
      `<td>${esc(t.type||'')}</td>`+
      `<td class="ix-v">${esc(val)}</td>`+
      `<td>${qDot(quality)} ${esc(quality)}</td>`+
      `<td class="ix-muted">${esc(updated)}</td>`
    }));
  }
  tbl.append(tb);sec.append(tbl);
  if(tags.namespaces){
    sec.append(el('p',{class:'ix-muted'},'namespaces: '+tags.namespaces.join(', ')));
  }
  root.append(sec);
}

// ─── Live mesh feed ───

function buildMeshFeed(root,{sub}){
  const sec=el('section',{class:'ix-sec'});
  const hd=el('div',{class:'ix-row'},[
    el('h2',{},'🛰️ Mesh feed'),
    el('span',{class:'ix-muted'},'BroadcastChannel("acg-mesh") · cross-tab'),
  ]);
  sec.append(hd);

  const ctl=el('div',{class:'ix-row'});
  const input=el('input',{class:'ix-in',placeholder:'ping message…',type:'text'});
  const btn=el('button',{class:'ix-btn'},'📣 broadcast');
  btn.addEventListener('click',()=>{
    const text=input.value.trim()||'ping';
    bridge.publish(sub,'ping',{path:'broadcast',value:text});
    input.value='';
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter')btn.click()});
  ctl.append(input,btn);
  sec.append(ctl);

  const tbl=el('table',{class:'ix-tbl ix-feed'});
  tbl.append(el('thead',{html:'<tr><th>ts</th><th>source</th><th>type</th><th>path</th><th>value</th></tr>'}));
  const tb=el('tbody');
  tbl.append(tb);sec.append(tbl);
  root.append(sec);

  // live subscribe
  bridge.subscribe(env=>{
    const tr=el('tr',{html:
      `<td class="ix-muted">${fmtTs(env.ts)}</td>`+
      `<td><code>${esc(env.source||'?')}</code></td>`+
      `<td>${esc(env.type||'')}</td>`+
      `<td><code>${esc(env.path||'')}</code></td>`+
      `<td class="ix-v">${esc(typeof env.value==='object'?JSON.stringify(env.value):(env.value??''))}</td>`
    });
    tb.prepend(tr);
    while(tb.children.length>50)tb.removeChild(tb.lastChild);
  });
}

// ─── main ───

export async function renderSection(opts){
  const{sub,glyph,name,desc}=opts;
  const root=document.getElementById('section')||document.body;
  root.innerHTML='';
  buildHeader(root,{sub,glyph,name,desc});

  const udtsP=fetchJson(opts.udtsPath||'./udts.json').catch(()=>null);
  const tagsP=fetchJson(opts.tagsPath||'./tags.json').catch(()=>null);
  const dbP  =fetchJson(opts.dbPath  ||'../db/tags.json').catch(()=>null);
  const [udts,tags,db]=await Promise.all([udtsP,tagsP,dbP]);

  buildUdts(root,udts);
  buildTags(root,tags,db);
  buildMeshFeed(root,{sub});

  // announce ourselves to the bus so sibling pages see us arrive
  bridge.publish(sub,'page-open',{path:location.pathname,value:{href:location.href}});

  // announce on unload too (best-effort)
  window.addEventListener('beforeunload',()=>{
    bridge.publish(sub,'page-close',{path:location.pathname});
  });
}
