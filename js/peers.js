import {$,esc,log} from './ui.js';
import {myId,myNm,myEm} from './config.js';
import {addMsg} from './chat.js';
import {getProfile} from './auth.js';

export const pm=new Map();

function meCard(){
  const p=getProfile();
  return {name:p?.username||myNm,emoji:myEm,avatar:p?.avatar||null};
}

function avatarHtml(info){
  return info.avatar
    ?`<div class="pa"><img src="${esc(info.avatar)}" alt=""></div>`
    :`<div class="pa">${esc(info.emoji||'⚒️')}</div>`;
}

export function wire(dc,rid){
  dc.binaryType='arraybuffer';
  dc.onopen=()=>{
    log('✓ channel open → '+rid.slice(-8),'ok');
    if(!pm.has(rid))pm.set(rid,{name:rid.slice(-8),emoji:'⚒️',avatar:null,dcs:new Set()});
    pm.get(rid).dcs.add(dc);updPeers();
    addMsg(null,null,null,'⚒️ '+rid.slice(-8)+' connected',true);
    const me=meCard();
    try{dc.send(JSON.stringify({t:'hi',id:myId,nm:me.name,em:me.emoji,av:me.avatar}))}catch(e){}
  };
  dc.onclose=()=>{
    if(pm.has(rid)){const info=pm.get(rid);info.dcs.delete(dc);
      if(info.dcs.size===0){addMsg(null,null,null,info.emoji+' '+info.name+' left',true);pm.delete(rid)}}
    updPeers();
  };
  dc.onerror=e=>log('dc err: '+rid.slice(-8),'er');
  dc.onmessage=e=>{try{
    const m=JSON.parse(e.data);
    if(m.t==='hi'){
      const pid=m.id||rid;
      if(!pm.has(pid))pm.set(pid,{name:m.nm||pid.slice(-8),emoji:m.em||'⚒️',avatar:m.av||null,dcs:new Set()});
      const info=pm.get(pid);info.name=m.nm||info.name;info.emoji=m.em||info.emoji;info.avatar=m.av||info.avatar;info.dcs.add(dc);updPeers();
    }else if(m.t==='msg'){
      const pid=m.id||rid;const info=pm.get(pid)||{name:pid.slice(-8),emoji:'⚒️',avatar:null};
      addMsg(pid,info.name,info.emoji,m.txt,false,info.avatar);
    }
  }catch(er){log('parse err','er')}};
}

export function updPeers(){
  const el=$('pList');el.innerHTML='';
  const me=meCard();
  const s=document.createElement('div');s.className='pc me';
  s.innerHTML=`${avatarHtml(me)}<div class="pn2">${esc(me.name)}<small>you</small></div>`;
  el.appendChild(s);
  let n=0;
  for(const[,info]of pm){if(info.dcs.size===0)continue;n++;
    const c=document.createElement('div');c.className='pc';
    c.innerHTML=`${avatarHtml(info)}<div class="pn2">${esc(info.name)}</div>`;
    el.appendChild(c);
  }
  $('nP').textContent=n+1;$('pLb').textContent=(n+1)+' online';
}
