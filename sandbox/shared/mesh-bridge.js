// ═══ ACG Sandbox ↔ mesh bridge ═══
// A thin BroadcastChannel wrapper so sandbox tools (in their own tabs) can
// stream events to the main ACG P2P page, which folds them into its SCADA
// tag plant under `sandbox.<tool>.*`. One channel, one shape.
//
//   Event envelope: {type:'sandbox', tool, event, data, ts}
//
// Usage from a sandbox tool:
//   import {bridge} from '../shared/mesh-bridge.js';
//   bridge.publish('web-llm', 'tool-call', {name, args, ok:true});
//   bridge.publish('web-llm', 'file-change', {path, size});
//
// Usage from the main ACG page:
//   bridge.subscribe(e => { /* e = {tool, event, data, ts} */ });

const CHAN='acg-sandbox';

function openChannel(){
  try{return new BroadcastChannel(CHAN)}
  catch(e){return null} // BroadcastChannel unsupported (rare)
}

const ch=openChannel();

export const bridge={
  publish(tool,event,data={}){
    const env={type:'sandbox',tool,event,data,ts:Date.now()};
    if(ch)try{ch.postMessage(env)}catch(e){}
    return env;
  },
  subscribe(fn){
    if(!ch)return()=>{};
    const handler=e=>{if(e?.data?.type==='sandbox')fn(e.data)};
    ch.addEventListener('message',handler);
    return()=>ch.removeEventListener('message',handler);
  },
  close(){if(ch)ch.close()},
};
