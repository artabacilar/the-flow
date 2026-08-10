const H='http://localhost:4222';
let pass=0,fail=0;
const ok=(n,c,d)=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(d!==undefined?'  → '+JSON.stringify(d):'')));};
const jar={};
async function call(path,opts={},who='anon'){
  const h=Object.assign({'Content-Type':'application/json'},opts.headers||{});
  if(jar[who]) h.Cookie=jar[who];
  const r=await fetch(H+path,Object.assign({},opts,{headers:h}));
  const sc=r.headers.get('set-cookie');
  if(sc) jar[who]=sc.split(';')[0];
  let b=null; try{ b=await r.json(); }catch(e){}
  return {status:r.status, body:b, headers:r.headers};
}
(async()=>{
  console.log('\n— before any account —');
  let r=await call('/api/all');
  ok('unauthenticated /api/all is refused', r.status===401, r.status);
  r=await call('/api/set',{method:'POST',body:JSON.stringify({key:'ld_journal',value:'[]'})});
  ok('unauthenticated write is refused', r.status===401, r.status);
  r=await call('/api/auth/me');
  ok('/api/auth/me says signed out', r.status===200&&r.body.ok===false, r.body);
  ok('and reports first-run', r.body.needsSetup===true, r.body);

  console.log('\n— creating the owner account —');
  r=await call('/api/auth/signup',{method:'POST',body:JSON.stringify({email:'artur@abko.com.tr',password:'short'})},'artur');
  ok('rejects a short password', r.status===400, r.body);
  r=await call('/api/auth/signup',{method:'POST',body:JSON.stringify({email:'nope',password:'longenoughpw'})},'artur');
  ok('rejects a bad email', r.status===400, r.body);
  r=await call('/api/auth/signup',{method:'POST',body:JSON.stringify({email:'Artur@ABKO.com.tr',password:'correct horse battery',name:'Artur'})},'artur');
  ok('creates the first account', r.status===200&&r.body.ok, r.body);
  ok('first account is the owner', r.body.user.owner===true, r.body.user);
  ok('email is normalised to lowercase', r.body.user.email==='artur@abko.com.tr', r.body.user.email);

  console.log('\n— the session works —');
  r=await call('/api/auth/me',{},'artur');
  ok('me returns the signed-in user', r.status===200&&r.body.user.email==='artur@abko.com.tr', r.body);
  r=await call('/api/set',{method:'POST',body:JSON.stringify({key:'ld_journal',value:JSON.stringify([{t:'x',txt:'mine'}])})},'artur');
  ok('authenticated write accepted', r.status===200, r.body);
  r=await call('/api/all',{},'artur');
  ok('owner sees their own key', !!r.body.ld_journal, Object.keys(r.body||{}));
  ok('namespace prefix is hidden from the client', Object.keys(r.body).every(k=>k.indexOf('u:')!==0), Object.keys(r.body));

  console.log('\n— a second account is fully isolated —');
  r=await call('/api/auth/signup',{method:'POST',body:JSON.stringify({email:'sister@example.com',password:'another good one'})},'sis');
  ok('second account created', r.status===200, r.body);
  ok('second account is NOT owner', r.body.user.owner===false, r.body.user);
  r=await call('/api/all',{},'sis');
  ok('sister starts empty', Object.keys(r.body||{}).length===0, r.body);
  await call('/api/set',{method:'POST',body:JSON.stringify({key:'ld_journal',value:JSON.stringify([{t:'y',txt:'hers'}])})},'sis');
  r=await call('/api/all',{},'sis');
  ok('sister sees only her own journal', JSON.parse(r.body.ld_journal)[0].txt==='hers', r.body.ld_journal);
  r=await call('/api/all',{},'artur');
  ok("artur's journal is untouched by hers", JSON.parse(r.body.ld_journal)[0].txt==='mine', r.body.ld_journal);
  r=await call('/api/get?key=ld_journal',{},'sis');
  ok('cross-account read by key is impossible', JSON.parse(r.body.value)[0].txt==='hers', r.body.value);
  r=await call('/api/export',{},'sis');
  ok('export is scoped too', Object.keys(r.body.data).length===1, Object.keys(r.body.data));

  console.log('\n— passwords and sessions —');
  r=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:'artur@abko.com.tr',password:'wrong password here'})},'bad');
  ok('wrong password refused', r.status===401, r.body);
  r=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:'ghost@example.com',password:'whatever it is'})},'bad');
  ok('unknown account gives the same error', r.status===401&&/Wrong email or password/.test(r.body.error), r.body);
  r=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:'artur@abko.com.tr',password:'correct horse battery'})},'artur2');
  ok('correct password signs in', r.status===200, r.body);
  const setC = r.headers.get('set-cookie')||'';
  ok('session is HttpOnly', /HttpOnly/i.test(setC), setC);
  ok('session is SameSite=Lax', /SameSite=Lax/i.test(setC), setC);
  r=await call('/api/all',{},'artur2');
  ok('a second device sees the same data', JSON.parse(r.body.ld_journal)[0].txt==='mine');
  await call('/api/auth/logout',{},'artur2');
  r=await call('/api/all',{},'artur2');
  ok('logout revokes the session server-side', r.status===401, r.status);
  r=await call('/api/all',{},'artur');
  ok('the other device stays signed in', r.status===200);

  console.log('\n— duplicate + invite —');
  r=await call('/api/auth/signup',{method:'POST',body:JSON.stringify({email:'sister@example.com',password:'yet another one'})},'dup');
  ok('duplicate email refused', r.status===409, r.body);

  console.log('\n— CORS is no longer wide open for the API —');
  const cr=await fetch(H+'/api/all',{headers:{Origin:'https://evil.example'}});
  ok('origin is echoed, not wildcarded', cr.headers.get('access-control-allow-origin')==='https://evil.example', cr.headers.get('access-control-allow-origin'));
  ok('and it is still refused without a session', cr.status===401, cr.status);

  console.log('\n  '+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
})();
