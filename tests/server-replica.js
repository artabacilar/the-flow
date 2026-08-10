const http=require('http'), fs=require('fs'), path=require('path');
const PORT=process.env.PORT||4222;
const flowAuth = require('../flow-auth');                    // EDIT 1
/* SEED for small fixtures; SEED_FILE for realistic ones — a megabyte of
   JSON does not fit in an environment variable. */
const DATA = process.env.SEED_FILE
  ? JSON.parse(require('fs').readFileSync(process.env.SEED_FILE, 'utf8'))
  : (process.env.SEED ? JSON.parse(process.env.SEED) : {});
const DASH_PATH = process.env.DASH || path.join(__dirname,'..','life-dashboard.html');
const PACK_FILES = ['flow-pack.js','flow-pack.css'];
let SHELL = null;
function packVersion(){
  try{ const h=require('crypto').createHash('sha256');
    for(const f of PACK_FILES) h.update(fs.readFileSync(path.join(path.dirname(DASH_PATH),f)));
    return h.digest('hex').slice(0,12);
  }catch(e){ return 'missing'; }
}
function shell(){
  if(SHELL) return SHELL;
  SHELL = fs.readFileSync(DASH_PATH,'utf8').split('__PACK_V__').join(packVersion());
  return SHELL;
}

let store = {
  engine:'JSON', file:'life-os-data.json',
  get:async(k)=>{ if(global.__BROKEN) throw new Error('store unavailable (cold start)'); return (k in DATA?DATA[k]:null); },
  set:async(k,v)=>{ DATA[k]= typeof v==='string'?v:JSON.stringify(v); },
  all:async()=>{ const o={}; for(const k in DATA) if(k.indexOf('ld_')===0) o[k]=DATA[k]; return o; },  // mimics Upstash `KEYS ld_*`
  count:async()=>Object.keys(DATA).length
};
store = flowAuth.protect(store);                            // EDIT 2
function readBody(req){return new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});}
function json(res,code,obj){res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,`http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try{
    const p=u.pathname;
    if(p==='/api/status') return json(res,200,{ok:true,engine:store.engine,file:store.file,keys:await store.count()});
    if(p==='/api/all') return json(res,200,await store.all());
    if(p==='/api/get') return json(res,200,{key:u.searchParams.get('key'),value:await store.get(u.searchParams.get('key'))});
    if(p==='/api/set'&&req.method==='POST'){const b=JSON.parse(await readBody(req));
      if(!b.key) return json(res,400,{error:'key required'});
      await store.set(b.key, typeof b.value==='string'?b.value:JSON.stringify(b.value));
      return json(res,200,{ok:true});}
    if(p==='/api/bulk'&&req.method==='POST'){const b=JSON.parse(await readBody(req));const d=b.data||b;const clean={};
      for(const k in d) clean[k]= typeof d[k]==='string'?d[k]:JSON.stringify(d[k]);
      for(const k in clean) await store.set(k,clean[k]);
      return json(res,200,{ok:true,saved:Object.keys(clean).length});}
    if(p==='/api/export') return json(res,200,{exported:new Date().toISOString(),app:'artur-life-dashboard-v2',data:await store.all()});
    /* The pack is served alongside the shell, exactly as production does — and
       with the same content-hash version, so a test that passes here is not
       passing against a page assembled differently from the real one. */
    if(p==='/flow-pack.js'||p==='/flow-pack.css'){
      const f=path.join(path.dirname(DASH_PATH),p.slice(1));
      if(!fs.existsSync(f)){res.writeHead(404);return res.end('no pack');}
      /* Same cache policy as production — without it a measurement of what a
         repeat open costs is measuring the replica, not the app. */
      res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8',
        'Cache-Control':'public, max-age=31536000, immutable'});
      return res.end(fs.readFileSync(f));}
    if(p==='/'||p==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(shell());}
    res.writeHead(404);res.end('Not found');
  }catch(e){ json(res,500,{error:String(e&&e.message||e)}); }
});
flowAuth.attach(server);                                    // EDIT 3
require('http').createServer((rq,rs)=>{
  if(rq.url==='/break'){ global.__BROKEN=true; rs.writeHead(200);return rs.end('broken'); }
  if(rq.url==='/fix'){ global.__BROKEN=false; rs.writeHead(200);return rs.end('fixed'); }
  rs.writeHead(200,{'Content-Type':'application/json'});rs.end(JSON.stringify(DATA));}).listen(4223); // test probe
server.listen(PORT,'0.0.0.0',()=>console.log('replica on '+PORT));
