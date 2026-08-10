const {_internals:{hashPassword}} = require('../../flow-auth.js');
const crypto=require('crypto'), fs=require('fs');
const uid='a1b2c3d4e5f60718293a', salt=crypto.randomBytes(16).toString('hex');
const pre='ld_u'+uid+':';
const D={};
// his real profile, exactly the shape now stored on the live server
const prof=JSON.parse(fs.readFileSync('/tmp/live-profile.json','utf8'));
D[pre+'flow:profile']=JSON.stringify(prof);
D[pre+'ld_journal']=JSON.stringify([{cat:'x',t:'2025-01-01',txt:'entry'}]);
D['__auth:users']=JSON.stringify({'artur.abacilar@abko.com.tr':{id:uid,
  email:'artur.abacilar@abko.com.tr',name:'Artur',salt,
  hash:hashPassword('a properly long password',salt),owner:true,created:'2026-08-03T00:00:00Z'}});
D['__auth:seed:'+uid]=JSON.stringify('legacy');
D['__auth:legacy_claimed_v2']=JSON.stringify({uid,keys:1});
D['__auth:packclaimed:'+uid]=JSON.stringify({keys:1});
process.stdout.write(JSON.stringify(D));
