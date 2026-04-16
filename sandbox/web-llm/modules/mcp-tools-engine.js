// ═══ MCP Tools Engine ═══
// In-memory virtual filesystem + git-lite + LLM tool-call parser.
// Every mutation publishes a BroadcastChannel event so the main ACG page's
// SCADA plant can fold sandbox activity into `sandbox.web-llm.*` tags.

import {bridge} from '../../shared/mesh-bridge.js';

const TOOL='web-llm';
const repo={
  name:'my-project',
  branch:'main',
  files:new Map(),          // path -> {content, mtime}
  commits:[],               // [{id, message, timestamp, snapshot}]
  staged:new Map(),         // path -> content (pre-commit working tree diff)
};

const nextCommitId=()=>Math.random().toString(36).slice(2,9);
const now=()=>Date.now();
const normalize=p=>p.startsWith('/')?p:('/'+p);
const publish=(event,data)=>bridge.publish(TOOL,event,data);

function typeOf(path){
  const ext=(path.split('.').pop()||'').toLowerCase();
  return {html:'html',htm:'html',css:'css',js:'javascript',mjs:'javascript',
          json:'json',md:'markdown',txt:'text',svg:'svg'}[ext]||'other';
}

/* ═══ FS operations ═══ */
export function createFile(path,content=''){
  const p=normalize(path);
  if(repo.files.has(p))return{ok:false,error:'file exists: '+p};
  repo.files.set(p,{content,mtime:now()});
  publish('create_file',{path:p,size:content.length});
  return{ok:true,path:p,size:content.length};
}

export function editFile(path,content=''){
  const p=normalize(path);
  if(!repo.files.has(p))return createFile(p,content);
  repo.files.get(p).content=content;
  repo.files.get(p).mtime=now();
  publish('edit_file',{path:p,size:content.length});
  return{ok:true,path:p,size:content.length};
}

export function patchFile(path,oldStr,newStr){
  const p=normalize(path);
  const f=repo.files.get(p);
  if(!f)return{ok:false,error:'not found: '+p};
  if(!f.content.includes(oldStr))return{ok:false,error:'oldStr not found'};
  f.content=f.content.replace(oldStr,newStr);
  f.mtime=now();
  publish('patch_file',{path:p,size:f.content.length});
  return{ok:true,path:p,size:f.content.length};
}

export function readFile(path){
  const p=normalize(path);
  const f=repo.files.get(p);
  if(!f)return{ok:false,error:'not found: '+p};
  return{ok:true,path:p,content:f.content,type:typeOf(p),size:f.content.length};
}

export function deleteFile(path){
  const p=normalize(path);
  if(!repo.files.has(p))return{ok:false,error:'not found: '+p};
  repo.files.delete(p);
  publish('delete_file',{path:p});
  return{ok:true,path:p};
}

export function listFiles(prefix='/'){
  const files=[];
  for(const[p,f]of repo.files){
    if(!prefix||prefix==='/'||p.startsWith(prefix)){
      files.push({path:p,type:typeOf(p),size:f.content.length,mtime:f.mtime});
    }
  }
  files.sort((a,b)=>a.path.localeCompare(b.path));
  return{count:files.length,files};
}

export function searchFiles(query){
  const q=String(query||'').toLowerCase();
  const results=[];
  if(!q)return{results};
  for(const[p,f]of repo.files){
    const hay=f.content.toLowerCase();
    let i=0,hits=0;
    while((i=hay.indexOf(q,i))!==-1){hits++;i+=q.length}
    if(hits)results.push({path:p,matches:hits});
  }
  return{results,count:results.length};
}

export function getAllFiles(){
  const out={};
  for(const[p,f]of repo.files)out[p]=f.content;
  return out;
}

/* ═══ Git-lite ═══ */
export function initRepo(name='my-project'){
  repo.name=name;repo.branch='main';
  repo.files.clear();repo.commits.length=0;repo.staged.clear();
  publish('init_repo',{name});
  return{ok:true,name};
}

export function commitChanges(message='update'){
  const id=nextCommitId();
  const snapshot={};
  for(const[p,f]of repo.files)snapshot[p]=f.content;
  repo.commits.unshift({id,message,timestamp:now(),snapshot});
  publish('commit',{id,message,files:Object.keys(snapshot).length});
  return{ok:true,id,message};
}

export function getLog(n=20){
  return{commits:repo.commits.slice(0,n).map(c=>({id:c.id,message:c.message,timestamp:c.timestamp}))};
}

export function getDiff(){
  // naive: compare working tree vs HEAD commit snapshot
  const head=repo.commits[0]?.snapshot||{};
  const added=[],modified=[],deleted=[];
  for(const[p,f]of repo.files){
    if(!(p in head))added.push(p);
    else if(head[p]!==f.content)modified.push(p);
  }
  for(const p of Object.keys(head))if(!repo.files.has(p))deleted.push(p);
  return{added,modified,deleted};
}

export function checkout(ref){
  const c=repo.commits.find(x=>x.id===ref);
  if(!c)return{ok:false,error:'unknown ref: '+ref};
  repo.files.clear();
  for(const[p,content]of Object.entries(c.snapshot))repo.files.set(p,{content,mtime:now()});
  publish('checkout',{id:ref});
  return{ok:true,id:ref};
}

export function getRepoState(){
  return{
    name:repo.name,
    branch:repo.branch,
    fileCount:repo.files.size,
    files:Array.from(repo.files.keys()),
    commitCount:repo.commits.length,
  };
}

/* ═══ Preview ═══ */
export function getPreviewableFiles(){
  const files=[];
  for(const p of repo.files.keys())if(typeOf(p)==='html')files.push(p);
  files.sort();
  return{files};
}

// Inline same-folder <link rel=stylesheet> and <script src> so the iframe
// can render the html file without a real server.
export function getPreviewHTML(path){
  const p=normalize(path);
  const f=repo.files.get(p);
  if(!f)return{ok:false,error:'not found: '+p};
  if(typeOf(p)!=='html')return{ok:false,error:'not html: '+p};
  const dir=p.replace(/\/[^\/]*$/,'')||'/';
  const resolve=rel=>{
    if(rel.startsWith('/'))return rel;
    if(rel.startsWith('http'))return null;
    return (dir==='/'?'':dir)+'/'+rel.replace(/^\.\//,'');
  };
  let html=f.content;
  html=html.replace(/<link\s+[^>]*rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*>/gi,(m,href)=>{
    const abs=resolve(href);
    const css=abs&&repo.files.get(abs)?.content;
    return css?`<style>/* ${abs} */\n${css}\n</style>`:m;
  });
  html=html.replace(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,(m,src)=>{
    const abs=resolve(src);
    const js=abs&&repo.files.get(abs)?.content;
    return js?`<script>/* ${abs} */\n${js}\n<\/script>`:m;
  });
  return{ok:true,html,path:p};
}

/* ═══ Tool parser + executor ═══
 * Fenced LLM tool call syntax:
 *   ```create /path/file.ext
 *   <content>
 *   ```
 *   ```edit /path/file.ext
 *   <new content>
 *   ```
 *   ```delete /path/file.ext
 *   ```
 *   ```commit <message>
 *   ```
 *   ```preview /path/file.html
 *   ```
 *   ```list [/prefix]
 *   ```
 *   ```read /path
 *   ```
 *   ```search <query>
 *   ```
 */
export function parseToolCalls(text){
  const calls=[];
  const re=/```(\w+)\s+([^\n]*?)\n([\s\S]*?)```/g;
  let m;
  while((m=re.exec(text))!==null){
    const [,name,firstLine,body]=m;
    const lc=name.toLowerCase();
    if(lc==='create'||lc==='edit')calls.push({name:lc+'_file',args:{path:firstLine.trim(),content:body.replace(/\n$/,'')}});
    else if(lc==='delete')calls.push({name:'delete_file',args:{path:firstLine.trim()}});
    else if(lc==='patch'){
      const parts=body.split(/\n---\n/);
      if(parts.length===2)calls.push({name:'patch_file',args:{path:firstLine.trim(),oldStr:parts[0],newStr:parts[1].replace(/\n$/,'')}});
    }
    else if(lc==='commit')calls.push({name:'commit',args:{message:(firstLine+(body?' '+body:'')).trim()||'update'}});
    else if(lc==='preview')calls.push({name:'preview',args:{path:firstLine.trim()}});
    else if(lc==='list')calls.push({name:'list_files',args:{prefix:firstLine.trim()||'/'}});
    else if(lc==='read')calls.push({name:'read_file',args:{path:firstLine.trim()}});
    else if(lc==='search')calls.push({name:'search_files',args:{query:(firstLine+body).trim()}});
  }
  // Empty-body fences: ```list\n``` without an arg after the name
  const reEmpty=/```(list|commit)\s*\n```/gi;
  while((m=reEmpty.exec(text))!==null){
    const lc=m[1].toLowerCase();
    if(lc==='list')calls.push({name:'list_files',args:{prefix:'/'}});
    else if(lc==='commit')calls.push({name:'commit',args:{message:'update'}});
  }
  return calls;
}

const DISPATCH={
  create_file:(a)=>createFile(a.path,a.content??''),
  edit_file:(a)=>editFile(a.path,a.content??''),
  patch_file:(a)=>patchFile(a.path,a.oldStr,a.newStr),
  delete_file:(a)=>deleteFile(a.path),
  read_file:(a)=>readFile(a.path),
  list_files:(a)=>listFiles(a.prefix||'/'),
  search_files:(a)=>searchFiles(a.query),
  commit:(a)=>commitChanges(a.message||'update'),
  preview:(a)=>getPreviewHTML(a.path),
};

export function executeTool(name,args={}){
  const fn=DISPATCH[name];
  if(!fn)return{ok:false,error:'unknown tool: '+name};
  try{
    const result=fn(args);
    publish('tool_call',{name,args,ok:!!result.ok});
    return result;
  }catch(e){
    publish('tool_call',{name,args,ok:false,error:e.message});
    return{ok:false,error:e.message};
  }
}

export function buildToolSystemPrompt(){
  return `You are a coding agent inside a browser sandbox with a virtual filesystem.
You can call tools by emitting fenced code blocks. One tool per fence.

Available tools (use EXACT syntax):

\`\`\`create /path/file.ext
<file content>
\`\`\`

\`\`\`edit /path/file.ext
<new full content>
\`\`\`

\`\`\`delete /path/file.ext
\`\`\`

\`\`\`preview /path/file.html
\`\`\`

\`\`\`commit <message>
\`\`\`

\`\`\`list /prefix
\`\`\`

\`\`\`read /path/file.ext
\`\`\`

\`\`\`search <query>
\`\`\`

Rules:
- Always use absolute paths starting with /.
- Keep files small and self-contained; inline CSS and JS into HTML when possible.
- After creating a runnable HTML file, you may emit a preview tool to show it.
- Explain what you're doing in plain text between fences.
`;
}
