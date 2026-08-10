const {_internals:{hashPassword}} = require('../../flow-auth.js');
const crypto=require('crypto');
const uid='a1b2c3d4e5f60718293a', salt=crypto.randomBytes(16).toString('hex');
const j=[]; for(let i=0;i<295;i++) j.push({t:'2025-01-01',txt:'entry '+i});
const orig={ ld_journal:JSON.stringify(j), ld_training:JSON.stringify({week:1}),
             ld_finance:JSON.stringify({tx:[]}), ld_notes:JSON.stringify([]) };
const D=Object.assign({},orig);
for(const k in orig) D['u:'+uid+':'+k]=orig[k];        // the old, invisible namespace
D['__auth:users']=JSON.stringify({'artur.abacilar@abko.com.tr':{id:uid,
  email:'artur.abacilar@abko.com.tr',name:'Artur Abacılar',salt,
  hash:hashPassword('a properly long password',salt),owner:true,created:'2026-08-03T00:00:00Z'}});
D['__auth:legacy_claimed']=JSON.stringify({uid,at:'2026-08-03T00:00:00Z',keys:4});
if(process.env.V2) D['__auth:legacy_claimed_v2']=JSON.stringify({uid,at:'2026-08-03T00:10:00Z',keys:4});
D['__auth:seed:'+uid]=JSON.stringify('legacy');
process.stdout.write(JSON.stringify(D));
