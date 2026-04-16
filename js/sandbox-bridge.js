// ═══ Sandbox ↔ ACG bridge (main side) ═══
// Subscribes to BroadcastChannel('acg-sandbox') and folds each event into
// the SCADA tag plant under `sandbox.<tool>.*`. When a sandbox tool relays
// its own tag writes (event === 'tag'), mirror the path verbatim so the
// main HMI shows the same hierarchy the tool uses internally.

import * as tags from './scada/tags.js';

const CHAN='acg-sandbox';
let ch=null;

function onEnvelope(env){
  if(!env||env.type!=='sandbox')return;
  const base=`sandbox.${env.tool||'unknown'}`;
  tags.write(base+'.lastEventAt',env.ts||Date.now(),{type:'DateTime'});
  tags.write(base+'.lastEvent',env.event||'');

  if(env.event==='tag'&&env.data?.path){
    // The sandbox is relaying one of its own tags — mirror it.
    const{path,tag}=env.data;
    tags.write(`${base}.${path}`,tag.value,{type:tag.type,quality:tag.quality});
  }else{
    // Generic event → flattened payload.
    const payload=env.data||{};
    tags.write(`${base}.event.${env.event}`,payload);
    tags.inc(`${base}.events.${env.event}.count`);
  }
}

export function startSandboxBridge(){
  try{ch=new BroadcastChannel(CHAN)}catch(e){return}
  ch.addEventListener('message',e=>onEnvelope(e.data));
  tags.write('sandbox.bridgeOpen',true);
}

export function stopSandboxBridge(){
  if(!ch)return;
  ch.close();ch=null;
  tags.write('sandbox.bridgeOpen',false);
}
