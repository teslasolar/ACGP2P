// ═══ Web-LLM UDTs ═══
// Structured schemas for tag payloads published by this tool. Mirrors the
// pattern used in /js/scada/udt.js for the main ACG app.

export const UDT={
  Model:{fields:['id','size','loaded','loadedAt','progress','status']},
  Engine:{fields:['ready','generating','streamedTokens','lastLatencyMs']},
  Voice:{fields:['micConnected','listening','rms','f0','energy','vowel','coherence','pulseRate']},
  Emotion:{fields:['dominant','excitement','calm','anger','sadness','joy','curiosity']},
  VFile:{fields:['path','type','size','mtime']},
  Commit:{fields:['id','message','ts','files']},
  ToolCall:{fields:['name','args','ok','result','ts']},
  ChatMsg:{fields:['role','len','ts','emoTag']},
};

export function mkUDT(type,data={}){
  const def=UDT[type];
  if(!def)throw new Error('unknown UDT: '+type);
  const o={_udt:type};
  for(const f of def.fields)o[f]=data[f]??null;
  return o;
}
