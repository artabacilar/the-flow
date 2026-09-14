const {_internals:{hashPassword}} = require('../../flow-auth.js');
const crypto=require('crypto'), fs=require('fs');
const uid='a1b2c3d4e5f60718293a', salt=crypto.randomBytes(16).toString('hex');
const pre='ld_u'+uid+':';
const D={};
// his real profile, exactly the shape now stored on the live server
/* The owner's real profile, as it is actually stored on the live server.
   It is a scratch capture rather than a committed fixture — it is his
   personal content — so say so plainly when it is not here instead of
   dying on an ENOENT that reads like a broken test. */
const path=require('path');
const CANDIDATES=[path.join(__dirname,'live-profile.json'),'/tmp/live-profile.json'];
const found=CANDIDATES.filter(f=>fs.existsSync(f))[0];
if(!found){
  process.stderr.write('no owner profile capture found. Looked in:\n  '+CANDIDATES.join('\n  ')+
    '\nThis suite checks that the owner gets his own content back, so it cannot run\n'+
    'against the template. Re-capture it from the live server into the first path.\n');
  process.exit(3);
}
const prof=JSON.parse(fs.readFileSync(found,'utf8'));
D[pre+'flow:profile']=JSON.stringify(prof);
D[pre+'ld_journal']=JSON.stringify([{cat:'x',t:'2025-01-01',txt:'entry'}]);
D['__auth:users']=JSON.stringify({'artur.abacilar@abko.com.tr':{id:uid,
  email:'artur.abacilar@abko.com.tr',name:'Artur',salt,
  hash:hashPassword('a properly long password',salt),owner:true,created:'2026-08-03T00:00:00Z'}});
D['__auth:seed:'+uid]=JSON.stringify('legacy');
D['__auth:legacy_claimed_v2']=JSON.stringify({uid,keys:1});
D['__auth:packclaimed:'+uid]=JSON.stringify({keys:1});
process.stdout.write(JSON.stringify(D));
