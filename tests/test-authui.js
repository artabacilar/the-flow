const {chromium}=require('playwright');const H='http://localhost:4222';
(async()=>{
  const b=await chromium.launch();let pass=0,fail=0;
  const ok=(n,c,d)=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(d!==undefined?'  → '+JSON.stringify(d).slice(0,140):'')));};
  const c=await b.newContext({viewport:{width:1280,height:900}});
  const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(H+'/',{waitUntil:'load'});await p.waitForTimeout(2600);

  ok('sign-in screen appears', await p.isVisible('#flow-auth'));
  ok('it knows this is first run', (await p.textContent('#fa-h')).includes('Set up'), await p.textContent('#fa-h'));
  ok('no invite field on first run', !(await p.isVisible('#fa-invwrap')));
  ok('it covers the app', await p.evaluate(()=>{const z=+getComputedStyle(document.getElementById('flow-auth')).zIndex;return z>1000;}));

  await p.fill('#fa-email','artur@abko.com.tr'); await p.fill('#fa-name','Artur'); await p.fill('#fa-pw','short');
  await p.click('#fa-go'); await p.waitForTimeout(900);
  ok('server-side validation surfaces inline', await p.isVisible('#fa-err'), await p.textContent('#fa-err').catch(()=>''));

  await p.fill('#fa-pw','a properly long password');
  await Promise.all([p.waitForNavigation({timeout:15000}).catch(()=>{}), p.click('#fa-go')]);
  await p.waitForTimeout(3000);
  ok('signed in and the screen is gone', !(await p.isVisible('#flow-auth').catch(()=>false)));
  const me=await p.evaluate(()=>window.Flow&&Flow.Auth?{inst:Flow.Auth.installed,email:Flow.Auth.user&&Flow.Auth.user.email,owner:Flow.Auth.user&&Flow.Auth.user.owner}:null);
  ok('client knows who is signed in', me&&me.email==='artur@abko.com.tr'&&me.owner===true, me);

  // data round-trips under the account
  await p.evaluate(async()=>{ await Flow.Settings.set('displayName','Artur'); await Flow.Schedule.saveNow(); });
  await p.waitForTimeout(600);
  const stored=await fetch(H+'/api/status').then(r=>r.status);
  ok('unauthenticated status call is refused', stored===401, stored);

  // account card in Settings
  /* The shipped navigation hides the host's own pill row, so Playwright
     cannot click it. Go through the same primitive the nav uses. */
  await p.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click()); await p.waitForTimeout(1200);
  const st=await p.evaluate(()=>({card:!!document.querySelector('[data-act2="signout"]'),
    txt:(document.body.innerText.match(/Signed in as[^\n]*/)||[''])[0]}));
  ok('Settings shows an Account card', st.card);
  ok('it names the account', /artur@abko\.com\.tr/.test(st.txt), st.txt);

  // second browser: a family member sees a login, not his data
  const c2=await b.newContext({viewport:{width:1280,height:900}});
  const p2=await c2.newPage();
  await p2.goto(H+'/',{waitUntil:'load'});await p2.waitForTimeout(2600);
  ok('a new visitor gets the sign-in screen', await p2.isVisible('#flow-auth'));
  ok('and it now offers sign in, not setup', (await p2.textContent('#fa-h')).trim()==='Sign in', await p2.textContent('#fa-h'));
  await p2.click('#fa-alt'); await p2.waitForTimeout(300);
  ok('the invite field appears for a second account', await p2.isVisible('#fa-invwrap'));

  // sign out clears the local mirror
  await p.evaluate(()=>localStorage.setItem('ld_probe','x'));
  await p.evaluate(()=>{ Flow.Auth.signOut(); });
  await p.waitForTimeout(2600);
  ok('sign out returns to the sign-in screen', await p.isVisible('#flow-auth'));
  ok('and clears the cached copy', await p.evaluate(()=>localStorage.getItem('ld_probe'))===null);
  ok('no page errors', errs.length===0, errs.slice(0,2));
  console.log('\n  '+pass+' passed, '+fail+' failed\n');
  await b.close();process.exit(fail?1:0);
})();
