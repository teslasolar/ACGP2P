import {$,log} from './ui.js';
import {TRACKERS,myId,myNm} from './config.js';
import {updPeers} from './peers.js';
import {send} from './chat.js';
import {join,announce,wsReady} from './p2p.js';
import {startVersion} from './version.js';

$('mId').textContent=myNm;

$('jBtn').onclick=()=>join($('rIn').value.trim()||'acg-guild');
$('cIn').onkeydown=e=>{if(e.key==='Enter')send()};
$('sBtn').onclick=send;

log('⚒ ACG P2P Mesh v1.1','hi');
log('peer: '+myId+' (20 bytes ✓)','hi');
log('trackers: '+TRACKERS.length+' with auto-fallback','hi');
updPeers();
startVersion();
setTimeout(()=>join($('rIn').value.trim()||'acg-guild'),300);

// periodic re-announce
setInterval(()=>{if(wsReady())announce()},30000);
