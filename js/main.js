import {$,log} from './ui.js';
import {TRACKERS,myId,myNm,myEm} from './config.js';
import {pm,updPeers} from './peers.js';
import {send} from './chat.js';
import {join,announce,wsReady} from './p2p.js';
import {startVersion} from './version.js';
import {startAuth,onProfileChange,getProfile} from './auth.js';

function meLabel(){const p=getProfile();return p?.username||myNm}

$('mId').textContent=meLabel();

$('jBtn').onclick=()=>join($('rIn').value.trim()||'acg-guild');
$('cIn').onkeydown=e=>{if(e.key==='Enter')send()};
$('sBtn').onclick=send;

log('⚒ ACG P2P Mesh v1.1','hi');
log('peer: '+myId+' (20 bytes ✓)','hi');
log('trackers: '+TRACKERS.length+' with auto-fallback','hi');
updPeers();
startVersion();
startAuth();

onProfileChange(p=>{
  $('mId').textContent=meLabel();
  updPeers();
  // re-send hi to open peers so they pick up new name/avatar
  const me=getProfile();
  const hi=JSON.stringify({t:'hi',id:myId,nm:me?.username||myNm,em:myEm,av:me?.avatar||null});
  for(const[,info]of pm)for(const dc of info.dcs)if(dc.readyState==='open'){try{dc.send(hi)}catch(e){}}
});

setTimeout(()=>join($('rIn').value.trim()||'acg-guild'),300);

// periodic re-announce
setInterval(()=>{if(wsReady())announce()},30000);
