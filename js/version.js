import {$} from './ui.js';
import {VERSION} from './scada/providers.js';

const REPO='teslasolar/ACGP2P';
const BRANCH='main';
const CACHE_KEY='acg.version';
const STALE_MS=5*60*1000;     // 5 min between fresh fetches
let last=loadCache();

function loadCache(){
  try{const c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');return c&&c.sha?c:null}
  catch{return null}
}
function saveCache(rec){
  try{localStorage.setItem(CACHE_KEY,JSON.stringify(rec))}catch(e){}
}

function rel(ts){
  const s=Math.floor((Date.now()-new Date(ts).getTime())/1000);
  if(s<60)return s+'s ago';
  if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}

function paint(){
  const el=$('ver');if(!el)return;
  if(!last){el.textContent='⌖ dev';el.title='no commit data yet';return}
  el.textContent=`⌖ ${last.sha.slice(0,7)} · ${rel(last.date)}`;
  el.href=last.url;
  el.title=`${last.msg}\n${new Date(last.date).toLocaleString()}\n(cached ${rel(last.fetchedAt)})`;
}

function publishTags(){
  if(!last)return;
  VERSION.write('sha',last.sha);
  VERSION.write('shortSha',last.sha.slice(0,7));
  VERSION.write('committedAt',last.date,{type:'DateTime'});
  VERSION.write('message',last.msg);
  VERSION.write('url',last.url);
}

async function fetchVersion(){
  // skip network if we have fresh cache
  if(last&&(Date.now()-last.fetchedAt)<STALE_MS){paint();publishTags();return}
  const headers={'Accept':'application/vnd.github+json'};
  if(last?.etag)headers['If-None-Match']=last.etag;
  try{
    const r=await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`,{headers});
    if(r.status===304){                       // unchanged — just bump fetchedAt
      last.fetchedAt=Date.now();saveCache(last);paint();publishTags();return;
    }
    if(r.status===403){                       // rate-limited — keep cache
      if(last){paint();publishTags();$('ver').title='GitHub API rate-limited · showing cached '+last.sha.slice(0,7)}
      else{$('ver').textContent='⌖ dev';$('ver').title='GitHub API rate-limited · no cache'}
      VERSION.write('rateLimited',true,{quality:'bad'});
      return;
    }
    if(!r.ok)throw new Error('HTTP '+r.status);
    const c=await r.json();
    last={
      sha:c.sha,
      date:c.commit.author.date,
      url:c.html_url,
      msg:c.commit.message.split('\n')[0],
      etag:r.headers.get('etag')||null,
      fetchedAt:Date.now(),
    };
    saveCache(last);paint();publishTags();
    VERSION.write('rateLimited',false);
  }catch(e){
    // network error — keep cache if we have one
    if(last){paint();publishTags();$('ver').title='version fetch failed · cached '+last.sha.slice(0,7)+': '+e.message}
    else{$('ver').textContent='⌖ dev';$('ver').title='version fetch failed: '+e.message}
  }
}

export function startVersion(){
  paint();publishTags();   // show cached immediately
  fetchVersion();
  setInterval(paint,30000);          // refresh relative time
  setInterval(fetchVersion,5*60000); // re-poll every 5m (respects cache)
}
