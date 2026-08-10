const H='http://localhost:4222';
let pass=0,fail=0;
const ok=(n,c,d)=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(d!==undefined?'  → '+JSON.stringify(d):'')));};
const post=async(p,b)=>{const r=await fetch(H+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  let j=null;try{j=await r.json();}catch(e){}; return {status:r.status,body:j};};
(async()=>{
  let r=await post('/api/auth/signup',{email:'stranger@evil.com',password:'a long enough password'});
  ok('a stranger cannot claim the first account', r.status===403, r.body);
  ok('and is told why, without leaking anything', /reserved for its owner/i.test((r.body||{}).error||''), r.body);
  r=await post('/api/auth/signup',{email:'artur.abacilar@abko.com.tr',password:'a long enough password',name:'Artur'});
  ok('the owner can', r.status===200 && r.body.user.owner===true, r.body);
  r=await post('/api/auth/signup',{email:'brother@example.com',password:'another long password'});
  ok('a second account still needs the invite code', r.status===403, r.body);
  r=await post('/api/auth/signup',{email:'brother@example.com',password:'another long password',invite:'letmein'});
  ok('with the right code it works', r.status===200 && r.body.user.owner===false, r.body);
  console.log('\n  '+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
})();
