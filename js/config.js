export const TRACKERS=[
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.fastcast.nz',
];

export const ICE={iceServers:[
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'stun:stun2.l.google.com:19302'},
]};

export const N_OFFERS=10;

// 20 bytes exactly: '-ACG001-' (8) + 6 random bytes hex (12) = 20
export const myId='-ACG001-'+Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b=>b.toString(16).padStart(2,'0')).join('');
export const myNm=myId.slice(-8);
export const myEm=['⚒️','🔨','🛠️','⚙️','🔧','📐','🧬','🛡️'][parseInt(myId.slice(-2),16)%8];
