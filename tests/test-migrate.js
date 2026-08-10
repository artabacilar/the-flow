const H='http://localhost:4222';
let pass=0,fail=0;
const ok=(n,c,d)=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(d!==undefined?'  → '+JSON.stringify(d).slice(0,160):'')));};
const jar={};
const call=async(p,o={},who='a')=>{const h=Object.assign({'Content-Type':'application/json'},o.headers||{});
  if(jar[who])h.Cookie=jar[who];
  const r=await fetch(H+p,Object.assign({},o,{headers:h}));
  const sc=r.headers.get('set-cookie'); if(sc) jar[who]=sc.split(';')[0];
  let b=null;try{b=await r.json();}catch(e){}; return {status:r.status,body:b};};
(async()=>{
  console.log('\n— existing data, then the owner signs up —');
  let r=await call('/api/auth/signup',{method:'POST',body:JSON.stringify({email:'artur@abko.com.tr',password:'a properly long password',name:'Artur'})},'artur');
  ok('owner account created', r.status===200, r.body);
  ok('it reports how many keys it adopted', r.body.adopted===4, r.body.adopted);
  r=await call('/api/all',{},'artur');
  const keys=Object.keys(r.body||{});
  ok('all the old keys are visible to the owner', keys.length===4, keys);
  ok('the 295 journal entries survived', JSON.parse(r.body.ld_journal).length===295, keys);
  ok('training data survived', !!r.body.ld_training);
  ok('finance data survived', !!r.body.ld_finance);
  r=await call('/api/get?key=ld_journal',{},'artur');
  ok('reading by key works', JSON.parse(r.body.value).length===295);

  console.log('\n— a family member gets nothing of his —');
  r=await call('/api/auth/signup',{method:'POST',body:JSON.stringify({email:'brother@example.com',password:'another long password'})},'bro');
  ok('second account created', r.status===200, r.body);
  ok('adopted nothing', r.body.adopted===0, r.body.adopted);
  r=await call('/api/all',{},'bro');
  ok('brother sees an empty app', Object.keys(r.body||{}).length===0, r.body);

  console.log('\n— the migration only ever runs once —');
  await call('/api/set',{method:'POST',body:JSON.stringify({key:'ld_journal',value:JSON.stringify([{t:'new'}])})},'artur');
  r=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:'artur@abko.com.tr',password:'a properly long password'})},'artur3');
  r=await call('/api/all',{},'artur3');
  ok('re-login does not resurrect the old journal over the new one', JSON.parse(r.body.ld_journal).length===1, r.body.ld_journal);

  console.log('\n— concurrency: interleaved requests must not cross accounts —');
  const work=[];
  for(let i=0;i<40;i++){
    work.push(call('/api/set',{method:'POST',body:JSON.stringify({key:'probe',value:'artur-'+i})},'artur'));
    work.push(call('/api/set',{method:'POST',body:JSON.stringify({key:'probe',value:'bro-'+i})},'bro'));
  }
  await Promise.all(work);
  const reads=await Promise.all([...Array(30)].flatMap(()=>[call('/api/get?key=probe',{},'artur'),call('/api/get?key=probe',{},'bro')]));
  const arturVals=reads.filter((_,i)=>i%2===0).map(x=>x.body.value);
  const broVals=reads.filter((_,i)=>i%2===1).map(x=>x.body.value);
  ok('artur never reads brother\'s value', arturVals.every(v=>/^artur-/.test(v)), arturVals.filter(v=>!/^artur-/.test(v)));
  ok('brother never reads artur\'s value', broVals.every(v=>/^bro-/.test(v)), broVals.filter(v=>!/^bro-/.test(v)));

  console.log('\n  '+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
})();
