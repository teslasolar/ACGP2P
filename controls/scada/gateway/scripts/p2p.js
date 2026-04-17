import {log,badge} from './ui.js';
import {TRACKERS,ICE,N_OFFERS,myId} from './config.js';
import {pm,wire,updPeers} from './peers.js';
import {addMsg} from './chat.js';
import {ROOM,TRACKER,SIGNAL,PEERS} from './scada/providers.js';
import {mkUDT} from './scada/udt.js';

// ═══ Multi-tracker signalling ════════════════════════════════════════
// Peers on different trackers only find each other if BOTH peers are
// connected to a common tracker.  So we connect to *every* tracker in
// TRACKERS simultaneously and announce the same offer batch on each.
// Individual tracker disconnects reconnect with exponential backoff.
// Full room rejoin only happens when the user changes rooms.

let hash=null,room='',reTimer=null;
const sockets=new Map();             // url -> WebSocket
const reconnectTimers=new Map();     // url -> setTimeout handle
const reconnectAttempts=new Map();   // url -> count (for back-off)
const pending=new Map();             // offer_id -> RTCPeerConnection

// Unanswered offers expire so we don't leak RTCPeerConnections — Chrome
// caps at ~500 per document, and 10 offers per tracker per 30s gets
// there fast if we never reap.
const PENDING_TTL_MS=60000;
const CONNECT_TIMEOUT_MS=6000;
const RECONNECT_BACKOFF_MS=[3000,6000,12000,30000,60000];

// ── utility ─────────────────────────────────────────────────────────
async function mkHash(name){
  const buf=await crypto.subtle.digest('SHA-1',new TextEncoder().encode('acg:'+name));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function urlIdx(url){return TRACKERS.indexOf(url)}

function openSockets(){
  const out=[];
  for(const[,s]of sockets)if(s.readyState===1)out.push(s);
  return out;
}
function openUrls(){
  const out=[];
  for(const[u,s]of sockets)if(s.readyState===1)out.push(u);
  return out;
}

// ── tag plant reflect ───────────────────────────────────────────────
function publishTrackers(){
  // per-URL tile
  for(const url of TRACKERS){
    const s=sockets.get(url);
    const state = !s                ? 'offline'
                : s.readyState===0  ? 'connecting'
                : s.readyState===1  ? 'connected'
                : /* closing/closed */'offline';
    TRACKER.write('trackers.'+urlIdx(url),mkUDT('TrackerEndpoint',{
      url,state,rttMs:null,lastAt:Date.now(),
    }));
  }
  // overall
  const opens=openUrls();
  const overallState = opens.length ? 'connected'
                     : [...sockets.values()].some(s=>s.readyState===0) ? 'connecting'
                     : reconnectTimers.size ? 'reconnecting'
                     : 'offline';
  const primary = opens[0] || '';
  TRACKER.write('current',mkUDT('Tracker',{
    url:primary, state:overallState,
    connectedAt:primary?(TRACKER.read('current')?.value?.connectedAt||Date.now()):null,
    announces:TRACKER.read('announces')?.value||0,
    lastAnnounceAt:TRACKER.read('lastAnnounceAt')?.value||null,
    connectedCount:opens.length,
    configuredCount:TRACKERS.length,
  }));
  TRACKER.write('state',overallState);
  TRACKER.write('count',opens.length,{type:'Counter'});
  badge(overallState==='connected'?'connected'
       :overallState==='reconnecting'?'reconnecting'
       :overallState==='connecting'?'connecting'
       :'offline');
}

// ── ICE + offer generation (pooled; one batch is sent to every tracker)
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
    // expire the PC if no answer arrives — first tracker to deliver an
    // answer wins via onAnswer() which deletes from pending.
    setTimeout(()=>{
      if(!pending.has(oid))return;
      pending.delete(oid);
      const st=pc.connectionState;
      if(st!=='connected'&&st!=='connecting')try{pc.close()}catch(e){}
    },PENDING_TTL_MS);
  }
  return offers;
}

// ── offer/answer handlers ───────────────────────────────────────────
async function onOffer(msg,sock){
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
    // reply on the same tracker that delivered the offer
    if(sock.readyState===1){
      sock.send(JSON.stringify({
        action:'announce',info_hash:hash,peer_id:myId,
        to_peer_id:rid,answer:{type:'answer',sdp:pc.localDescription.sdp},offer_id:msg.offer_id
      }));
    }
    log('→ answer to '+rid.slice(-8),'ok');
    SIGNAL.write('last',mkUDT('SignalEvent',{kind:'answer',dir:'out',peerId:rid,offerId:msg.offer_id,ts:Date.now()}));
    SIGNAL.inc('answersOut');
  }catch(e){log('offer handling failed: '+e.message,'er')}
}

async function onAnswer(msg){
  const pc=pending.get(msg.offer_id);
  if(!pc)return;  // unknown or already matched by another tracker
  pending.delete(msg.offer_id);  // first tracker wins
  log('← answer for '+msg.offer_id.slice(0,8),'hi');
  SIGNAL.write('last',mkUDT('SignalEvent',{kind:'answer',dir:'in',offerId:msg.offer_id,ts:Date.now()}));
  SIGNAL.inc('answersIn');
  try{await pc.setRemoteDescription(msg.answer)}catch(e){log('answer err: '+e.message,'er')}
}

// ── announce fan-out ────────────────────────────────────────────────
export async function announce(){
  const opens=openSockets();
  if(!opens.length)return;
  const offers=await mkOffers(N_OFFERS);
  const payload=JSON.stringify({
    action:'announce',info_hash:hash,peer_id:myId,
    numwant:50,uploaded:0,downloaded:0,left:1,offers,
  });
  log('announcing '+N_OFFERS+' offers to '+opens.length+'/'+TRACKERS.length+' tracker(s)','hi');
  for(const s of opens){try{s.send(payload)}catch(e){}}
  TRACKER.inc('announces');
  TRACKER.write('lastAnnounceAt',Date.now(),{type:'DateTime'});
}

// ── per-tracker connect with exponential-backoff reconnect ──────────
export function connectTracker(url){
  // don't double-dial if already connected/connecting
  const existing=sockets.get(url);
  if(existing&&(existing.readyState===0||existing.readyState===1))return;

  if(reconnectTimers.has(url)){clearTimeout(reconnectTimers.get(url));reconnectTimers.delete(url)}
  log('trying: '+url,'hi');
  let sock;
  try{sock=new WebSocket(url)}
  catch(e){log('✗ '+url+' — '+e.message,'er');scheduleReconnect(url);return}

  sockets.set(url,sock);
  publishTrackers();

  const toHandle=setTimeout(()=>{
    if(sock.readyState!==1){
      log('✗ '+url+' — connect timeout','er');
      try{sock.close()}catch(e){}
    }
  },CONNECT_TIMEOUT_MS);

  sock.onopen=async()=>{
    clearTimeout(toHandle);
    reconnectAttempts.set(url,0);
    log('✓ '+url,'ok');
    addMsg(null,null,null,'✓ tracker '+url.split('/')[2]+' connected',true);
    publishTrackers();
    // seed the new tracker with an offer batch so it discovers peers
    try{
      const offers=await mkOffers(N_OFFERS);
      sock.send(JSON.stringify({
        action:'announce',info_hash:hash,peer_id:myId,
        numwant:50,uploaded:0,downloaded:0,left:1,offers,
      }));
      TRACKER.inc('announces');
      TRACKER.write('lastAnnounceAt',Date.now(),{type:'DateTime'});
    }catch(e){log('initial announce err '+url+': '+e.message,'er')}
  };

  sock.onmessage=async e=>{
    try{
      const m=JSON.parse(e.data);
      if(m.offer&&m.peer_id&&m.peer_id!==myId)await onOffer(m,sock);
      if(m.answer&&m.offer_id)await onAnswer(m);
      if(m.interval){
        const sec=Math.min(m.interval,30);
        if(reTimer)clearTimeout(reTimer);
        reTimer=setTimeout(announce,sec*1000);
      }
    }catch(er){log('msg err: '+er.message,'er')}
  };

  sock.onerror=()=>{/* close follows */};

  sock.onclose=()=>{
    clearTimeout(toHandle);
    sockets.delete(url);
    publishTrackers();
    if(!room)return;  // user left on purpose
    scheduleReconnect(url);
  };
}

function scheduleReconnect(url){
  const n=(reconnectAttempts.get(url)||0);
  reconnectAttempts.set(url,n+1);
  const ms=RECONNECT_BACKOFF_MS[Math.min(n,RECONNECT_BACKOFF_MS.length-1)];
  log('↻ '+url+' in '+(ms/1000)+'s','wr');
  reconnectTimers.set(url,setTimeout(()=>connectTracker(url),ms));
}

// ── join: fan out to every tracker; no single-tracker fallback ──────
export async function join(rName){
  // tear down previous sockets, timers, and pending PCs
  for(const[,t]of reconnectTimers)clearTimeout(t);
  reconnectTimers.clear();
  reconnectAttempts.clear();
  for(const[,s]of sockets){s.onclose=null;s.onerror=null;s.onmessage=null;try{s.close()}catch(e){}}
  sockets.clear();
  if(reTimer){clearTimeout(reTimer);reTimer=null}
  for(const[,pc]of pending)try{pc.close()}catch(e){}
  pending.clear();
  for(const[,info]of pm)for(const dc of info.dcs)try{dc.close()}catch(e){}
  pm.clear();PEERS.clear();updPeers();

  room=rName;hash=await mkHash(rName);
  log('room: '+rName+' hash: '+hash.slice(0,12)+'... · dialling '+TRACKERS.length+' trackers','hi');
  badge('connecting');
  ROOM.write('data',mkUDT('Room',{name:rName,hash,peerCount:1,joinedAt:Date.now()}));
  ROOM.write('name',rName);ROOM.write('hash',hash);ROOM.write('joinedAt',Date.now(),{type:'DateTime'});
  addMsg(null,null,null,'Joining '+rName+' via '+TRACKERS.length+' trackers…',true);

  // fan out to EVERY tracker in parallel — peers find each other via
  // the union of connected trackers instead of just one
  for(const url of TRACKERS)connectTracker(url);
}

// ── chat broadcast (unchanged) ──────────────────────────────────────
export function bcast(msg){
  const d=JSON.stringify(msg);let n=0;
  for(const[,info]of pm)for(const dc of info.dcs)if(dc.readyState==='open'){try{dc.send(d);n++}catch(e){}}
  return n;
}

// ── status probes used by main.js + monitor ─────────────────────────
export function wsReady(){return openSockets().length>0}
