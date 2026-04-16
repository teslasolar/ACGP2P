import {log,badge} from './ui.js';
import {TRACKERS,ICE,N_OFFERS,myId} from './config.js';
import {pm,wire,updPeers} from './peers.js';
import {addMsg} from './chat.js';

let ws=null,hash=null,room='',reTimer=null;
let trackerIdx=0;
const pending=new Map();

async function mkHash(name){
  const buf=await crypto.subtle.digest('SHA-1',new TextEncoder().encode('acg:'+name));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ═══ ICE + OFFER GENERATION ═══ */
function waitIce(pc,ms=4000){
  return new Promise(r=>{
    if(pc.iceGatheringState==='complete')return r();
    const t=setTimeout(r,ms);
    pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(t);r()}};
  });
}

export async function mkOffers(n){
  const offers=[];
  for(let i=0;i<n;i++){
    const oid=crypto.randomUUID();
    const pc=new RTCPeerConnection(ICE);
    const dc=pc.createDataChannel('acg',{ordered:true});
    wire(dc,oid);
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    offers.push({offer_id:oid,offer:{type:'offer',sdp:pc.localDescription.sdp}});
    pending.set(oid,pc);
  }
  return offers;
}

async function onOffer(msg){
  const rid=msg.peer_id;
  log('← offer from '+rid.slice(-8),'hi');
  const pc=new RTCPeerConnection(ICE);
  pc.ondatachannel=e=>wire(e.channel,rid);
  try{
    await pc.setRemoteDescription(msg.offer);
    const ans=await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await waitIce(pc);
    ws.send(JSON.stringify({
      action:'announce',info_hash:hash,peer_id:myId,
      to_peer_id:rid,answer:{type:'answer',sdp:pc.localDescription.sdp},offer_id:msg.offer_id
    }));
    log('→ answer to '+rid.slice(-8),'ok');
  }catch(e){log('offer handling failed: '+e.message,'er')}
}

async function onAnswer(msg){
  const pc=pending.get(msg.offer_id);
  if(!pc){log('unknown offer_id','wr');return}
  log('← answer for '+msg.offer_id.slice(0,8),'hi');
  try{await pc.setRemoteDescription(msg.answer)}catch(e){log('answer err: '+e.message,'er')}
}

export async function announce(){
  if(!ws||ws.readyState!==1)return;
  log('announcing '+N_OFFERS+' offers','hi');
  const offers=await mkOffers(N_OFFERS);
  ws.send(JSON.stringify({
    action:'announce',info_hash:hash,peer_id:myId,
    numwant:50,uploaded:0,downloaded:0,left:1,offers
  }));
  log('✓ announced','ok');
}

/* ═══ CONNECT TO TRACKER (with fallback chain) ═══ */
export function connectTracker(trackerUrl){
  return new Promise((resolve,reject)=>{
    log('trying: '+trackerUrl,'hi');
    const sock=new WebSocket(trackerUrl);
    const timeout=setTimeout(()=>{
      sock.onopen=null;sock.onerror=null;sock.onclose=null;
      try{sock.close()}catch(e){}
      reject(new Error('timeout'));
    },6000);
    sock.onopen=()=>{clearTimeout(timeout);resolve(sock)};
    sock.onerror=()=>{clearTimeout(timeout);reject(new Error('connection failed'))};
  });
}

export async function join(rName){
  if(ws){ws.onclose=null;ws.onerror=null;try{ws.close()}catch(e){}}
  if(reTimer)clearTimeout(reTimer);
  pending.clear();
  for(const[,info]of pm)for(const dc of info.dcs)try{dc.close()}catch(e){}
  pm.clear();updPeers();

  room=rName;hash=await mkHash(rName);
  log('room: '+rName+' hash: '+hash.slice(0,12)+'...','hi');
  badge('connecting');

  // try each tracker until one connects
  let connected=false;
  for(let attempt=0;attempt<TRACKERS.length;attempt++){
    const url=TRACKERS[(trackerIdx+attempt)%TRACKERS.length];
    try{
      ws=await connectTracker(url);
      trackerIdx=(trackerIdx+attempt)%TRACKERS.length; // remember which worked
      log('✓ connected to '+url,'ok');
      connected=true;

      badge('connected');
      addMsg(null,null,null,'Connected to room: '+rName+' via '+url.split('/')[2],true);

      ws.onmessage=async e=>{
        try{
          const m=JSON.parse(e.data);
          if(m.offer&&m.peer_id&&m.peer_id!==myId)await onOffer(m);
          if(m.answer&&m.offer_id)await onAnswer(m);
          if(m.interval){
            const sec=Math.min(m.interval,30);
            if(reTimer)clearTimeout(reTimer);
            reTimer=setTimeout(()=>announce(),sec*1000);
          }
        }catch(er){log('msg err: '+er.message,'er')}
      };

      ws.onclose=()=>{
        log('tracker disconnected — retrying in 3s','wr');
        badge('reconnecting');
        setTimeout(()=>join(room),3000);
      };

      ws.onerror=()=>{log('tracker ws error','er')};

      // initial announce
      await announce();
      break;

    }catch(e){
      log('✗ '+url+' — '+e.message,'er');
    }
  }

  if(!connected){
    log('all trackers failed — retrying in 5s','er');
    badge('offline');
    setTimeout(()=>join(room),5000);
  }
}

export function bcast(msg){
  const d=JSON.stringify(msg);let n=0;
  for(const[,info]of pm)for(const dc of info.dcs)if(dc.readyState==='open'){try{dc.send(d);n++}catch(e){}}
  return n;
}

// ws ready-state check for periodic re-announce
export function wsReady(){return ws&&ws.readyState===1}
