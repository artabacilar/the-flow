const {chromium}=require('playwright');const H='http://localhost:4222';
const PERSONAL=/CRM lead generation|Meet with Burak|Mali Neşe|Kanye West|Seamless\.ai|Goldwell|DualSense|Sabah spor|Hidrolize kolajen|3 litre su|promoters \/ distributors|ABKO|DTC Business/i;
(async()=>{
  const b=await chromium.launch();let pass=0,fail=0;
  const ok=(n,c,d)=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(d!==undefined?'  → '+JSON.stringify(d).slice(0,200):'')));};

  // ---- owner: existing data, must be unchanged ----
  const c1=await b.newContext();const p1=await c1.newPage();const e1=[];p1.on('pageerror',e=>e1.push(e.message));
  await p1.goto(H+'/',{waitUntil:'load'});await p1.waitForTimeout(2500);
  await p1.fill('#fa-email','artur@abko.com.tr');await p1.fill('#fa-name','Artur');await p1.fill('#fa-pw','a properly long password');
  await Promise.all([p1.waitForNavigation({timeout:15000}).catch(()=>{}),p1.click('#fa-go')]);
  await p1.waitForTimeout(3200);
  const owner=await p1.evaluate(()=>({
    isNew: Flow.Profile.isNew,
    ws: Flow.Profile.data.workspaces.map(w=>w.name),
    diet: Flow.Profile.data.dietCommon.map(r=>r[1]),
    saw: Flow.Profile.data.saw.length,
    pill: (document.querySelector('.tab[data-tab="abko"]')||{}).textContent
  }));
  console.log('\n  owner profile:',JSON.stringify({isNew:owner.isNew,ws:owner.ws,pill:owner.pill}));
  /* CHANGED BY DESIGN. The shipped file used to carry the owner's own content
     as its defaults, so "is this the owner?" was answered by capturing that
     content back out of the code. The file is now the generic template —
     nobody's content ships with it — so an owner with no saved profile
     correctly gets the template too. An owner WITH a saved profile getting
     every piece of it back is proven against his real profile in
     test-strip.js. */
  ok('owner is still recognised as not-new', owner.isNew===false, owner.isNew);
  ok('but inherits nobody\'s boards from the code', owner.ws[0]==='Work'&&owner.ws[1]==='Side Project', owner.ws);
  ok('and inherits nobody\'s diet from the code', !owner.diet.some(d=>/3 litre su|kolajen/.test(d)), owner.diet.slice(0,2));
  ok('the tab pill ships generic', /Work/.test(owner.pill||'')&&!/ABKO/.test(owner.pill||''), owner.pill);
  ok('no errors for owner', e1.length===0, e1.slice(0,2));

  // ---- family member: brand new account ----
  const c2=await b.newContext();const p2=await c2.newPage();const e2=[];p2.on('pageerror',e=>e2.push(e.message));
  await p2.goto(H+'/',{waitUntil:'load'});await p2.waitForTimeout(2500);
  await p2.click('#fa-alt');await p2.waitForTimeout(300);
  await p2.fill('#fa-email','brother@example.com');await p2.fill('#fa-name','Brother');await p2.fill('#fa-pw','another long password');
  await Promise.all([p2.waitForNavigation({timeout:15000}).catch(()=>{}),p2.click('#fa-go')]);
  await p2.waitForTimeout(3500);

  const fam=await p2.evaluate(()=>({
    isNew: Flow.Profile.isNew,
    ws: Flow.Profile.data.workspaces.map(w=>w.name),
    pillA: (document.querySelector('.tab[data-tab="abko"]')||{}).textContent,
    pillD: (document.querySelector('.tab[data-tab="dtc"]')||{}).textContent,
    hdrA: (document.querySelector('#tab-abko .section-header')||{}).textContent,
    subA: (document.querySelector('#tab-abko .section-sub')||{}).textContent,
    diet: (typeof DIET_COMMON!=='undefined'?DIET_COMMON:[]).map(r=>r[1]),
    mission: (typeof cData!=='undefined'&&cData?cData.mission:''),
    saw: (typeof SAW_ITEMS!=='undefined'?SAW_ITEMS:[]).map(r=>r[1]),
    quad: (typeof qData!=='undefined'&&qData.items?qData.items.map(i=>i.txt):[]),
    plan: (typeof PLAN!=='undefined'?PLAN.map(d=>d.title):[])
  }));
  console.log('  family workspaces:',JSON.stringify(fam.ws));
  console.log('  family diet      :',JSON.stringify(fam.diet.slice(0,3)));
  console.log('  family priorities:',JSON.stringify(fam.quad.slice(0,2)));
  ok('new account IS treated as new', fam.isNew===true, fam.isNew);
  ok('boards renamed to Work / Side Project', fam.ws[0]==='Work'&&fam.ws[1]==='Side Project', fam.ws);
  ok('tab pills renamed', /Work/.test(fam.pillA||'')&&/Side Project/.test(fam.pillD||''), [fam.pillA,fam.pillD]);
  ok('section header renamed', /Work/.test(fam.hdrA||'')&&!/ABKO/.test(fam.hdrA||''), fam.hdrA);
  ok('section blurb no longer mentions ABKO', !/ABKO/.test(fam.subA||''), fam.subA);
  ok('diet is generic English', fam.diet.some(d=>/water/i.test(d))&&!fam.diet.some(d=>/litre su|kolajen/i.test(d)), fam.diet);
  ok('weekly commitments are generic', !fam.saw.some(s=>/Burak|promoters/i.test(s)), fam.saw.filter(s=>/Burak|promoters/i.test(s)));
  ok('priorities are generic', !fam.quad.some(q=>PERSONAL.test(q)), fam.quad.filter(q=>PERSONAL.test(q)));
  ok('training plan is generic', fam.plan.some(t=>/Push/i.test(t)), fam.plan.slice(0,3));
  ok('mission statement is NOT pre-filled with the owner\'s', !/buy my freedom|outlives me/i.test(fam.mission||''), (fam.mission||'').slice(0,60));

  // the whole rendered page must be free of personal content
  const leak=await p2.evaluate((src)=>{
    const re=new RegExp(src,'i');
    const hits=[];
    document.querySelectorAll('.section, .tabs, #moreGrid').forEach(n=>{
      const t=n.innerText||'';
      t.split('\n').forEach(line=>{ if(re.test(line)) hits.push(line.trim().slice(0,70)); });
    });
    return [...new Set(hits)];
  }, PERSONAL.source);
  ok('nothing personal anywhere in the rendered app', leak.length===0, leak);
  ok('no errors for the family member', e2.length===0, e2.slice(0,2));

  // editing the profile sticks
  /* The shipped navigation hides the host's own pill row, so Playwright
     cannot click it. Go through the same primitive the nav uses. */
  await p2.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());await p2.waitForTimeout(1200);
  await p2.fill('[data-ws="0"][data-wsf="name"]','Bakery');
  await p2.fill('[data-prof="dietCommon"]','💧 Water\n🍎 Fruit');
  await p2.click('[data-act2="profsave"]');await p2.waitForTimeout(1400);
  const edited=await p2.evaluate(()=>({
    pill:(document.querySelector('.tab[data-tab="abko"]')||{}).textContent,
    diet:(typeof DIET_COMMON!=='undefined'?DIET_COMMON:[]).map(r=>r[1])
  }));
  ok('renaming a board takes effect immediately', /Bakery/.test(edited.pill||''), edited.pill);
  ok('editing the checklist takes effect', edited.diet.length===2&&/Fruit/.test(edited.diet[1]), edited.diet);
  await p2.reload();await p2.waitForTimeout(3000);
  const persisted=await p2.evaluate(()=>({
    pill:(document.querySelector('.tab[data-tab="abko"]')||{}).textContent,
    diet:(typeof DIET_COMMON!=='undefined'?DIET_COMMON:[]).map(r=>r[1])}));
  ok('it survives a reload', /Bakery/.test(persisted.pill||'')&&persisted.diet.length===2, persisted);

  // and none of it touched the owner
  await p1.reload();await p1.waitForTimeout(3000);
  const ownerAfter=await p1.evaluate(()=>({
    pill:(document.querySelector('.tab[data-tab="abko"]')||{}).textContent,
    diet:(typeof DIET_COMMON!=='undefined'?DIET_COMMON:[]).map(r=>r[1])}));
  /* The point of these two is isolation: the family member renamed a board and
     rewrote a checklist, and none of it may reach the owner's session. */
  ok("the owner's board is untouched by the family member's rename", !/Bakery/.test(ownerAfter.pill||''), ownerAfter.pill);
  ok("the owner's diet is untouched by their checklist edit", !ownerAfter.diet.some(d=>/Fruit/.test(d)), ownerAfter.diet.slice(0,2));

  console.log('\n  '+pass+' passed, '+fail+' failed\n');
  await b.close();process.exit(fail?1:0);
})();
