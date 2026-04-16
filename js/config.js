// Order = fallback priority.  Confirmed-working (per /health.html probe)
// go first so join() lands on its feet inside one RTT.
export const TRACKERS=[
  'wss://tracker.openwebtorrent.com',   // ✓ ~400 ms
  'wss://tracker.webtorrent.dev',       // ✓ ~700 ms
  'wss://tracker.files.fm:7073/announce',
  'wss://tracker.novage.com.ua',
  'wss://tracker.sloppyta.co:443/announce',
  'wss://tracker.btorrent.xyz',         // ✗ as of last probe
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

/* ═══ OAUTH (configure before use) ═══
 * Discord: implicit grant works purely in-browser. Set DISCORD.clientId
 *   and add this origin's URL to the app's OAuth redirects in the Discord
 *   dev portal (https://discord.com/developers/applications).
 * GitHub:  OAuth + device flow endpoints do NOT send CORS headers, so a
 *   tiny proxy is required. Set GITHUB.proxyUrl to a Cloudflare Worker (or
 *   any backend) that forwards POST /device/code and /access_token to
 *   github.com and relays the response. Leave proxyUrl empty to disable.
 */
export const OAUTH={
  DISCORD:{
    clientId:'',                                   // set me
    redirectUri:location.origin+location.pathname, // this page
    scope:'identify',
  },
  GITHUB:{
    clientId:'',   // set me (public OAuth app client id)
    proxyUrl:'',   // set me (e.g. https://acg-gh-proxy.workers.dev)
    scope:'read:user',
  },
};
