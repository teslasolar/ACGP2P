// ═══ ACG subsystem-index renderer ═══
// Each subsystem's /{sub}/index.html calls renderSection({sub, glyph, name})
// and this module fetches ./udts.json, ./tags.json, and /db/tags.json, then
// paints a self-contained view.  Pages talk to each other across the
// BroadcastChannel('acg-mesh') bus so the live feed shows activity from
// sibling subsystem pages in real time.

import {bridge} from '../sandbox/shared/mesh-bridge.js';

// Canonical nav order — every subsystem index links to every other.
// `path` is the directory relative to the site root.  Nav hrefs are
// composed as `basePath + path + '/'` so pages at any depth resolve
// siblings correctly.
export const SUBSYSTEMS=[
  {sub:'chat',    glyph:'💬', name:'chat',    path:'chat'},
  {sub:'auth',    glyph:'🔑', name:'auth',    path:'auth'},
  {sub:'errors',  glyph:'⚠',  name:'errors',  path:'errors'},
  {sub:'scada',   glyph:'🖥️', name:'scada',   path:'controls/scada'},
  {sub:'sandbox', glyph:'🧪', name:'sandbox', path:'sandbox'},
  {sub:'db',      glyph:'🗄️', name:'db',      path:'db'},
];

// Top-right shell links (mesh, log, health, scada drawer).  `href` is
// site-root-relative; basePath is prefixed at render time.
const SHELL_LINKS=[
  {href:'',                 label:'⚒ mesh'},
  {href:'gateway-log.html', label:'⚠ log'},
  {href:'health.html',      label:'⚕ health'},
  {href:'#scada',           label:'🖥️ scada drawer'},
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

function buildHeader(root,{sub,glyph,name,desc,basePath}){
  const hd=el('header',{class:'ix-hd'},[
    el('h1',{class:'ix-logo'},[glyph+' '+name, el('span',{},' · ACG subsystem')]),
    ...SHELL_LINKS.map(l=>el('a',{class:'ix-shell',href:basePath+l.href},l.label)),
  ]);
  root.append(hd);
  if(desc)root.append(el('p',{class:'ix-lede'},desc));

  const nav=el('nav',{class:'ix-nav'},
    SUBSYSTEMS.map(s=>el('a',{
      class:'ix-pill'+(s.sub===sub?' on':''),
      href:basePath+s.path+'/',
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

// Heartbeat + refresh cadence (every open index page).
const HEARTBEAT_MS = 5000;
const REFRESH_MS   = 5000;

// Track sibling pages we've heard a heartbeat from in the last ~15 s.
// Key = source (subsystem name), value = {ts, path}.  Rendered into
// a "live clients" strip above the mesh feed.
const liveClients = new Map();

function renderClientsBar(host){
  if(!host)return;
  const now=Date.now();
  const alive=[...liveClients.entries()].filter(([,v])=>now-v.ts<15_000)
    .sort((a,b)=>a[0].localeCompare(b[0]));
  host.innerHTML=alive.length
    ?alive.map(([src,v])=>{
        const age=Math.floor((now-v.ts)/1000);
        return `<span class="ix-hbpill" title="last heartbeat ${age}s ago · ${v.path||''}">${esc(src)} · ${age}s</span>`;
      }).join('')
    :'<span class="ix-muted">no sibling pages seen in last 15 s</span>';
}

export async function renderSection(opts){
  const{sub,glyph,name,desc}=opts;
  const basePath=opts.basePath||'../';
  const root=document.getElementById('section')||document.body;
  root.innerHTML='';
  buildHeader(root,{sub,glyph,name,desc,basePath});

  const udtsP=fetchJson(opts.udtsPath||'./udts.json').catch(()=>null);
  const tagsP=fetchJson(opts.tagsPath||'./tags.json').catch(()=>null);
  const dbPath=opts.dbPath||basePath+'db/tags.json';
  let db=await fetchJson(dbPath).catch(()=>null);
  const [udts,tags]=await Promise.all([udtsP,tagsP]);

  buildUdts(root,udts);

  // Tag section — holds its own container so refresh() can replace it.
  const tagsHost=document.createElement('div');tagsHost.id='ix-tags';root.append(tagsHost);
  buildTags(tagsHost,tags,db);

  // Clients bar (before mesh feed) — live heartbeat digest.
  const clientsSec=el('section',{class:'ix-sec'},[
    el('h2',{},'💓 Live clients'),
    el('div',{id:'ix-clients',class:'ix-hbrow'},''),
  ]);
  root.append(clientsSec);
  const clientsHost=document.getElementById('ix-clients');

  buildMeshFeed(root,{sub});

  // Subscribe to heartbeats → liveClients map
  bridge.subscribe(env=>{
    if(env.type==='heartbeat'&&env.source){
      liveClients.set(env.source,{ts:env.ts||Date.now(),path:env.path||''});
    }
  });
  renderClientsBar(clientsHost);

  // Announce ourselves + heartbeat every 5s
  function beat(){
    bridge.publish(sub,'heartbeat',{path:location.pathname,value:{href:location.href}});
  }
  bridge.publish(sub,'page-open',{path:location.pathname,value:{href:location.href}});
  beat();
  setInterval(beat,HEARTBEAT_MS);

  // Re-paint clients bar on a separate cadence so age counters tick.
  setInterval(()=>renderClientsBar(clientsHost),1000);

  // Auto-refresh the tag table every 5s so live values tick.
  setInterval(async()=>{
    try{
      db=await fetchJson(dbPath+'?t='+Date.now());   // cache-bust
      tagsHost.innerHTML='';buildTags(tagsHost,tags,db);
    }catch(e){/* keep last render */}
  },REFRESH_MS);

  window.addEventListener('beforeunload',()=>{
    bridge.publish(sub,'page-close',{path:location.pathname});
  });
}
