import {log,badge} from './ui.js';
import {TRACKERS,ICE,N_OFFERS,myId} from './config.js';
import {pm,wire,updPeers} from './peers.js';
import {addMsg} from './chat.js';
import {ROOM,TRACKER,SIGNAL,PEERS} from './scada/providers.js';
import {mkUDT} from './scada/udt.js';

let ws=null,hash=null,room='',reTimer=null;
let trackerIdx=0;
const pending=new Map();

// Unanswered offers expire after this window so we don't leak
// RTCPeerConnection objects — Chrome caps at ~500 per document and
// 10 offers per 30 s re-announce will hit that in minutes.
const PENDING_TTL_MS=60000;

async function mkHash(name){
  const buf=await crypto.subtle.digest('SHA-1',new TextEncoder().encode('acg:'+name));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function publishTracker(url,state,extra={}){
  TRACKER.write('current',mkUDT('Tracker',{
    url,state,
    connectedAt:extra.connectedAt??TRACKER.read('current')?.value?.connectedAt??null,
    announces:TRACKER.read('announces')?.value||0,
    lastAnnounceAt:TRACKER.read('lastAnnounceAt')?.value||null,
    ...extra,
  }));
  TRACKER.write('state',state);
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
    // expire the pending PC if no answer arrives in PENDING_TTL_MS.
    // Answered offers are removed in onAnswer() — their PCs stay alive
    // via the open data channel tracked in pm (see peers.js).
    setTimeout(()=>{
      if(!pending.has(oid))return;
      pending.delete(oid);
      const st=pc.connectionState;
      if(st!=='connected'&&st!=='connecting')try{pc.close()}catch(e){}
    },PENDING_TTL_MS);
  }
  return offers;
}

async function onOffer(msg){
  const rid=msg.peer_id;
  log('← offer from '+rid.slice(-8),'hi');
  SIGNAL.write('last',mkUDT('SignalEvent',{kind:'offer',dir:'in',peerId:rid,offerId:msg.offer_id,ts:Date.now()}));
  SIGNAL.inc('offersIn');
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
    SIGNAL.write('last',mkUDT('SignalEvent',{kind:'answer',dir:'out',peerId:rid,offerId:msg.offer_id,ts:Date.now()}));
    SIGNAL.inc('answersOut');
  }catch(e){log('offer handling failed: '+e.message,'er')}
}

async function onAnswer(msg){
  const pc=pending.get(msg.offer_id);
  if(!pc){log('unknown offer_id','wr');return}
  // matched — the PC lives on via its open DataChannel (tracked in pm).
  pending.delete(msg.offer_id);
  log('← answer for '+msg.offer_id.slice(0,8),'hi');
  SIGNAL.write('last',mkUDT('SignalEvent',{kind:'answer',dir:'in',offerId:msg.offer_id,ts:Date.now()}));
  SIGNAL.inc('answersIn');
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
  TRACKER.inc('announces');
  TRACKER.write('lastAnnounceAt',Date.now(),{type:'DateTime'});
}

/* ═══ CONNECT TO TRACKER (with fallback chain) ═══ */
export function connectTracker(trackerUrl){
  return new Promise((resolve,reject)=>{
    log('trying: '+trackerUrl,'hi');
    publishTracker(trackerUrl,'connecting');
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
  // close every leftover pending PC before we clear the map
  for(const[,pc]of pending)try{pc.close()}catch(e){}
  pending.clear();
  for(const[,info]of pm)for(const dc of info.dcs)try{dc.close()}catch(e){}
  pm.clear();PEERS.clear();updPeers();

  room=rName;hash=await mkHash(rName);
  log('room: '+rName+' hash: '+hash.slice(0,12)+'...','hi');
  badge('connecting');
  ROOM.write('data',mkUDT('Room',{name:rName,hash,peerCount:1,joinedAt:Date.now()}));
  ROOM.write('name',rName);ROOM.write('hash',hash);ROOM.write('joinedAt',Date.now(),{type:'DateTime'});

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
      publishTracker(url,'connected',{connectedAt:Date.now()});
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
        publishTracker(url,'reconnecting');
        setTimeout(()=>join(room),3000);
      };

      ws.onerror=()=>{log('tracker ws error','er')};

      // initial announce
      await announce();
      break;

    }catch(e){
      log('✗ '+url+' — '+e.message,'er');
      publishTracker(url,'failed');
    }
  }

  if(!connected){
    log('all trackers failed — retrying in 5s','er');
    badge('offline');
    publishTracker('','offline');
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
