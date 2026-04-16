import {$,esc,log} from './ui.js';
import {OAUTH} from './config.js';
import {AUTH} from './scada/providers.js';
import {mkUDT} from './scada/udt.js';

const KEY='acg.profile';
const listeners=new Set();
let profile=load();
publishProfile();

function load(){
  try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}
}
function save(p){
  profile=p;
  if(p)localStorage.setItem(KEY,JSON.stringify(p));
  else localStorage.removeItem(KEY);
  publishProfile();
  listeners.forEach(f=>{try{f(profile)}catch(e){}});
  paint();
}

function publishProfile(){
  if(profile)AUTH.write('profile',mkUDT('Profile',profile));
  else AUTH.del('profile');
  AUTH.write('signedIn',!!profile);
}

export function getProfile(){return profile}
export function onProfileChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}
export function logout(){save(null);log('signed out','wr')}

/* ═══ DISCORD · implicit grant (pure browser) ═══ */
function discordLogin(){
  const {clientId,redirectUri,scope}=OAUTH.DISCORD;
  if(!clientId){log('discord clientId not configured','er');return}
  const state=crypto.randomUUID();
  sessionStorage.setItem('acg.oauth.state',state);
  sessionStorage.setItem('acg.oauth.provider','discord');
  const u=new URL('https://discord.com/oauth2/authorize');
  u.searchParams.set('client_id',clientId);
  u.searchParams.set('redirect_uri',redirectUri);
  u.searchParams.set('response_type','token');
  u.searchParams.set('scope',scope);
  u.searchParams.set('state',state);
  location.href=u.toString();
}

async function discordFinish(token){
  const r=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:'Bearer '+token}});
  if(!r.ok)throw new Error('discord /users/@me '+r.status);
  const u=await r.json();
  const avatar=u.avatar
    ?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
    :`https://cdn.discordapp.com/embed/avatars/${(parseInt(u.id)>>22)%6}.png`;
  save({provider:'discord',id:u.id,username:u.global_name||u.username,avatar});
  log('✓ signed in as '+(u.global_name||u.username)+' (discord)','ok');
}

/* ═══ GITHUB · device flow via CORS proxy ═══
 * Proxy contract (HTTPS POST, JSON in/out):
 *   POST {proxyUrl}/device/code
 *     body: {client_id, scope}  →  forwards to github.com/login/device/code
 *   POST {proxyUrl}/access_token
 *     body: {client_id, device_code, grant_type}
 *                              →  forwards to github.com/login/oauth/access_token
 * The proxy just sets CORS headers + Accept:application/json; it holds no secret.
 */
async function githubLogin(){
  const {clientId,proxyUrl,scope}=OAUTH.GITHUB;
  if(!clientId||!proxyUrl){
    log('github login: clientId or proxyUrl not configured','er');
    alert('GitHub login requires OAUTH.GITHUB.clientId and proxyUrl (see js/config.js)');
    return;
  }
  log('github: requesting device code…','hi');
  let dc;
  try{
    const r=await fetch(proxyUrl.replace(/\/$/,'')+'/device/code',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({client_id:clientId,scope}),
    });
    if(!r.ok)throw new Error('HTTP '+r.status);
    dc=await r.json();
  }catch(e){log('github device code failed: '+e.message,'er');return}

  // user completes auth on github.com
  window.open(dc.verification_uri,'_blank','noopener');
  prompt('Enter this code on GitHub → '+dc.verification_uri,dc.user_code);

  // poll for token
  const interval=(dc.interval||5)*1000,deadline=Date.now()+dc.expires_in*1000;
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,interval));
    try{
      const r=await fetch(proxyUrl.replace(/\/$/,'')+'/access_token',{
        method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({client_id:clientId,device_code:dc.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'}),
      });
      const j=await r.json();
      if(j.error==='authorization_pending')continue;
      if(j.error==='slow_down'){await new Promise(r=>setTimeout(r,5000));continue}
      if(j.error){log('github: '+j.error,'er');return}
      if(j.access_token){await githubFinish(j.access_token);return}
    }catch(e){log('github poll err: '+e.message,'er')}
  }
  log('github device flow timed out','er');
}

async function githubFinish(token){
  const r=await fetch('https://api.github.com/user',{headers:{Authorization:'token '+token,Accept:'application/vnd.github+json'}});
  if(!r.ok)throw new Error('github /user '+r.status);
  const u=await r.json();
  save({provider:'github',id:String(u.id),username:u.login,avatar:u.avatar_url});
  log('✓ signed in as '+u.login+' (github)','ok');
}

/* ═══ REDIRECT HANDLER (call once on load) ═══ */
async function handleRedirect(){
  // discord: #access_token in fragment
  if(location.hash.includes('access_token=')){
    const p=new URLSearchParams(location.hash.slice(1));
    const tok=p.get('access_token'),state=p.get('state');
    const expected=sessionStorage.getItem('acg.oauth.state');
    const provider=sessionStorage.getItem('acg.oauth.provider');
    sessionStorage.removeItem('acg.oauth.state');
    sessionStorage.removeItem('acg.oauth.provider');
    history.replaceState(null,'',location.pathname+location.search);
    if(!tok||state!==expected){log('oauth state mismatch','er');return}
    try{
      if(provider==='discord')await discordFinish(tok);
    }catch(e){log('oauth finish failed: '+e.message,'er')}
  }
}

/* ═══ UI ═══ */
function paint(){
  const host=$('auth');if(!host)return;
  host.innerHTML='';
  if(profile){
    const chip=document.createElement('div');chip.className='usr';
    chip.innerHTML=`<img src="${esc(profile.avatar)}" alt=""><span>${esc(profile.username)}</span><button class="bt g" id="lo">Sign out</button>`;
    host.appendChild(chip);
    $('lo').onclick=logout;
  }else{
    const gh=document.createElement('button');gh.className='bt g gh';gh.textContent='GitHub';gh.onclick=githubLogin;
    const dc=document.createElement('button');dc.className='bt g dc';dc.textContent='Discord';dc.onclick=discordLogin;
    host.append(gh,dc);
  }
}

export function startAuth(){
  paint();
  handleRedirect();
}
