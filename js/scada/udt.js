// ═══ UDT · User Defined Types ═══
// Schemas for structured tag payloads. mkUDT(type,data) returns a normalized
// object with every declared field present (unset → null) so the monitor/HMI
// can render consistent columns.

export const UDT={
  Peer:{fields:['id','name','emoji','avatar','state','channels','connectedAt','msgsIn','msgsOut','lastSeen']},
  Tracker:{fields:['url','state','connectedAt','announces','lastAnnounceAt']},
  Room:{fields:['name','hash','peerCount','joinedAt']},
  Channel:{fields:['id','peerId','state','openedAt']},
  Profile:{fields:['provider','id','username','avatar']},
  SignalEvent:{fields:['kind','dir','peerId','offerId','ts']},
};

export function mkUDT(type,data={}){
  const def=UDT[type];
  if(!def)throw new Error('unknown UDT: '+type);
  const o={_udt:type};
  for(const f of def.fields)o[f]=data[f]??null;
  return o;
}
