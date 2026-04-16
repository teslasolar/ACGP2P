// ═══ ACG subsystem-index renderer ═══
// Each /{sub}/index.html calls renderSection({sub, glyph, name}).  The
// renderer paints a five-dock shell (north, west, main, east, south)
// identical across every subsystem, then fills the main dock with UDTs
// + live tag table.  Pages heartbeat every 5 s on BroadcastChannel
// "acg-mesh" so open siblings can see each other in the east dock.

import {bridge} from '../sandbox/shared/mesh-bridge.js';

// ── catalogues ────────────────────────────────────────────────────────
export const SUBSYSTEMS=[
  {sub:'chat',    glyph:'💬', name:'chat',    path:'chat'},
  {sub:'auth',    glyph:'🔑', name:'auth',    path:'auth'},
  {sub:'errors',  glyph:'⚠',  name:'errors',  path:'errors'},
  {sub:'scada',   glyph:'🖥️', name:'scada',   path:'controls/scada'},
  {sub:'hmi',     glyph:'🖼', name:'hmi',     path:'controls/hmi'},
  {sub:'plc',     glyph:'🔧', name:'plc',     path:'controls/plc'},
  {sub:'sandbox', glyph:'🧪', name:'sandbox', path:'sandbox'},
  {sub:'db',      glyph:'🗄️', name:'db',      path:'db'},
];

const SHELL_LINKS=[
  {href:'',                 label:'⚒ mesh'},
  {href:'gateway-log.html', label:'⚠ log'},
  {href:'health.html',      label:'⚕ health'},
  {href:'#scada',           label:'🖥 scada drawer'},
];

const HEARTBEAT_MS = 5000;
const REFRESH_MS   = 5000;
const CLIENT_TTL   = 15000;

// ── utilities ────────────────────────────────────────────────────────
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

// ── NESW dock shell ──────────────────────────────────────────────────
export function buildDockShell(root){
  root.innerHTML='';
  root.className='dock-shell';
  const docks={
    n: el('header',{class:'dock-n'}),
    w: el('aside', {class:'dock-w'}),
    m: el('section',{class:'dock-m'}),
    e: el('aside', {class:'dock-e'}),
    s: el('footer',{class:'dock-s'}),
  };
  root.append(docks.n,docks.w,docks.m,docks.e,docks.s);
  return docks;
}

function paintNorth(host,{glyph,name,basePath}){
  host.append(el('div',{class:'dock-n-logo'},[glyph+' '+name, el('span',{},' · ACG subsystem')]));
  const shell=el('nav',{class:'dock-n-shell'},
    SHELL_LINKS.map(l=>el('a',{href:basePath+l.href},l.label))
  );
  host.append(shell);
}

function paintWest(host,{sub,basePath}){
  const nav=el('nav',{class:'dock-w-nav'},
    SUBSYSTEMS.map(s=>el('a',{
      class:s.sub===sub?'on':'',
      href:basePath+s.path+'/',
    },[s.glyph+' '+s.name]))
  );
  host.append(el('h4',{},'Subsystems'),nav);

  host.append(el('hr',{class:'dock-sep'}));

  host.append(el('h4',{},'Controls'));
  host.append(el('div',{class:'dock-w-actions'},[
    el('a',{href:basePath+'.github/ISSUE_TEMPLATE/tag-update.yml'},'🏷️ write tag'),
    el('a',{href:basePath+'.github/ISSUE_TEMPLATE/log-entry.yml'},'⚠ log incident'),
    el('a',{href:basePath+'.github/ISSUE_TEMPLATE/control-action.yml'},'🎛 control action'),
  ]));
}

// ── main dock paints ─────────────────────────────────────────────────
function paintDesc(host,desc){
  if(desc)host.append(el('p',{class:'ix-lede'},desc));
}

function paintUdts(host,udts){
  const sec=el('section',{class:'ix-sec'});
  sec.append(el('h2',{},'🏗️ UDTs'));
  if(!udts||!udts.types||!Object.keys(udts.types).length){
    sec.append(el('p',{class:'ix-muted'},'no UDTs declared'));
    host.append(sec);return;
  }
  for(const[name,def]of Object.entries(udts.types)){
    const card=el('div',{class:'ix-card'});
    card.append(el('h3',{},[def.glyph?def.glyph+' ':'',name]));
    if(def.desc)card.append(el('p',{class:'ix-muted'},def.desc));
    const tbl=el('table',{class:'ix-tbl'});
    tbl.append(el('thead',{html:'<tr><th>field</th><th>type</th></tr>'}));
    const tb=el('tbody');
    const fields=Array.isArray(def.fields)?def.fields.map(f=>[f,'any']):Object.entries(def.fields||{});
    for(const[f,t]of fields){
      tb.append(el('tr',{html:`<td>${esc(f)}</td><td><code>${esc(t)}</code></td>`}));
    }
    tbl.append(tb);card.append(tbl);sec.append(card);
  }
  host.append(sec);
}

function getLive(db,path){
  const parts=path.split('.');let x=db;
  for(const p of parts){if(x==null)return null;x=x[p]}
  return x&&x.value!==undefined?x:null;
}
function qDot(q){return({good:'🟢',stale:'🟡',bad:'🔴',uncertain:'⚪'})[q]||'⚪'}

function paintTags(host,tags,liveDb){
  host.innerHTML='';
  const sec=el('section',{class:'ix-sec'});
  sec.append(el('h2',{},'🏷️ Tags'));
  if(!tags||!tags.tags||!tags.tags.length){
    sec.append(el('p',{class:'ix-muted'},'no tags declared'));
    host.append(sec);return;
  }
  const tbl=el('table',{class:'ix-tbl'});
  tbl.append(el('thead',{html:'<tr><th>path</th><th>type</th><th>value</th><th>quality</th><th>updated</th></tr>'}));
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
  if(tags.namespaces)sec.append(el('p',{class:'ix-muted'},'namespaces: '+tags.namespaces.join(', ')));
  host.append(sec);
}

// ── east dock: live clients + broadcast ──────────────────────────────
function paintEast(host,{sub}){
  const clientsSec=el('section',{class:'dock-e-sec'},[
    el('h3',{},'💓 Live clients'),
    el('div',{id:'dock-e-clients',class:'ix-hbrow'}),
  ]);
  host.append(clientsSec);

  const castSec=el('section',{class:'dock-e-sec'},[el('h3',{},'📣 Broadcast')]);
  const row=el('div',{class:'ix-row'});
  const input=el('input',{class:'ix-in',placeholder:'ping sibling tabs…'});
  const btn=el('button',{class:'ix-btn'},'send');
  btn.addEventListener('click',()=>{
    const v=input.value.trim()||'ping';
    bridge.publish(sub,'ping',{path:'broadcast',value:v});
    input.value='';
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter')btn.click()});
  row.append(input,btn);
  castSec.append(row);
  host.append(castSec);

  const cadSec=el('section',{class:'dock-e-sec'},[
    el('h3',{},'⏱ Cadence'),
    el('p',{class:'ix-muted'},'heartbeat 5 s · tag refresh 5 s · commit poll 90 s'),
  ]);
  host.append(cadSec);
}

// ── south dock: rolling mesh feed ────────────────────────────────────
function paintSouth(host){
  host.append(el('span',{class:'dock-s-mark'},'⚒ AI Craftspeople Guild · P2P'));
  host.append(el('span',{class:'dock-s-feed',id:'dock-s-feed'},'— idle —'));
  host.append(el('span',{class:'dock-s-cadence',id:'dock-s-cadence'},'💓 5s'));
}

// ── live wiring: heartbeats + bus subscribe ──────────────────────────
const liveClients=new Map();

function paintClientsBar(host){
  if(!host)return;
  const now=Date.now();
  const alive=[...liveClients.entries()].filter(([,v])=>now-v.ts<CLIENT_TTL).sort((a,b)=>a[0].localeCompare(b[0]));
  host.innerHTML=alive.length
    ?alive.map(([src,v])=>{
        const age=Math.floor((now-v.ts)/1000);
        return `<span class="ix-hbpill" title="last heartbeat ${age}s ago · ${v.path||''}">${esc(src)} · ${age}s</span>`;
      }).join('')
    :'<span class="ix-muted">no sibling pages in last 15 s</span>';
}

function setFooterFeed(env){
  const f=document.getElementById('dock-s-feed');if(!f)return;
  const v=typeof env.value==='object'?JSON.stringify(env.value):(env.value??'');
  f.textContent=`${fmtTs(env.ts)} · ${env.source}/${env.type}${env.path?' · '+env.path:''}${v?' · '+v:''}`;
}

// ── entry ────────────────────────────────────────────────────────────
export async function renderSection(opts){
  const{sub,glyph,name,desc}=opts;
  const basePath=opts.basePath||'../';
  const root=document.getElementById('section')||document.body;

  const docks=buildDockShell(root);
  paintNorth(docks.n,{glyph,name,basePath});
  paintWest(docks.w,{sub,basePath});
  paintEast(docks.e,{sub});
  paintSouth(docks.s);

  paintDesc(docks.m,desc);
  const udtsP=fetchJson(opts.udtsPath||'./udts.json').catch(()=>null);
  const tagsP=fetchJson(opts.tagsPath||'./tags.json').catch(()=>null);
  const dbPath=opts.dbPath||basePath+'db/tags.json';
  let db=await fetchJson(dbPath).catch(()=>null);
  const [udts,tags]=await Promise.all([udtsP,tagsP]);

  paintUdts(docks.m,udts);
  const tagsHost=el('div',{id:'ix-tags'});docks.m.append(tagsHost);
  paintTags(tagsHost,tags,db);

  // bus: heartbeats → live clients, every envelope → footer ticker
  const clientsHost=document.getElementById('dock-e-clients');
  bridge.subscribe(env=>{
    if(env.type==='heartbeat'&&env.source){
      liveClients.set(env.source,{ts:env.ts||Date.now(),path:env.path||''});
    }
    setFooterFeed(env);
  });
  paintClientsBar(clientsHost);

  // heartbeat + repaint cadences
  function beat(){bridge.publish(sub,'heartbeat',{path:location.pathname,value:{href:location.href}})}
  bridge.publish(sub,'page-open',{path:location.pathname,value:{href:location.href}});
  beat();setInterval(beat,HEARTBEAT_MS);
  setInterval(()=>paintClientsBar(clientsHost),1000);

  // tag table auto-refresh
  setInterval(async()=>{
    try{
      db=await fetchJson(dbPath+'?t='+Date.now());
      paintTags(tagsHost,tags,db);
    }catch(e){}
  },REFRESH_MS);

  window.addEventListener('beforeunload',()=>{
    bridge.publish(sub,'page-close',{path:location.pathname});
  });
}
