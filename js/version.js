import {$} from './ui.js';

const REPO='teslasolar/ACGP2P';
const BRANCH='main';
let last=null;

function rel(ts){
  const s=Math.floor((Date.now()-new Date(ts).getTime())/1000);
  if(s<60)return s+'s ago';
  if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}

function paint(){
  if(!last)return;
  const el=$('ver');
  el.textContent=`⌖ ${last.sha.slice(0,7)} · ${rel(last.date)}`;
  el.href=last.url;
  el.title=`${last.msg}\n${new Date(last.date).toLocaleString()}`;
}

async function fetchVersion(){
  try{
    const r=await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const c=await r.json();
    last={sha:c.sha,date:c.commit.author.date,url:c.html_url,msg:c.commit.message.split('\n')[0]};
    paint();
  }catch(e){
    const el=$('ver');el.textContent='⌖ dev';el.title='version fetch failed: '+e.message;
  }
}

export function startVersion(){
  fetchVersion();
  setInterval(paint,30000);          // refresh relative time
  setInterval(fetchVersion,5*60000); // re-poll commit every 5m
}
