import {$,esc,log} from './ui.js';
import {myId,myNm,myEm} from './config.js';
import {bcast} from './p2p.js';

export function addMsg(pid,nm,em,txt,sys=false){
  const me=pid===myId;const d=document.createElement('div');d.className='ms'+(me?' me':'');
  if(sys)d.innerHTML=`<div class="mb sy">${esc(txt)}</div>`;
  else d.innerHTML=`<div class="mm">${esc(em)} ${esc(nm)}</div><div class="mb">${esc(txt)}</div>`;
  $('chat').appendChild(d);$('chat').scrollTop=$('chat').scrollHeight;
}

export function send(){
  const txt=$('cIn').value.trim();if(!txt)return;
  $('cIn').value='';
  const n=bcast({t:'msg',id:myId,txt});
  addMsg(myId,myNm,myEm,txt);
  if(n>0)log('→ sent to '+n+' peer(s)','ok');
  else log('→ no peers connected yet','wr');
}
