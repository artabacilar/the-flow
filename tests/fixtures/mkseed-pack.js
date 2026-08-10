const {_internals:{hashPassword}} = require('../../flow-auth.js');
const crypto=require('crypto');
const uid='a1b2c3d4e5f60718293a', salt=crypto.randomBytes(16).toString('hex');
const j=[]; for(let i=0;i<295;i++) j.push({cat:'x',t:'2025-01-01',txt:'auto '+i});
const D={ ld_journal:JSON.stringify(j), ld_training:JSON.stringify({week:1}),
          ld_finance:JSON.stringify({tx:[]}), ld_notes:JSON.stringify([]) };
// un-namespaced PACK data — invisible to KEYS ld_*
D['flow:journal']=JSON.stringify([{txt:'my first real entry',words:4},{txt:'second'},{txt:'third'}]);
D['flow:journal:ui']=JSON.stringify({logCollapsed:true,showPrompts:false});
D['flow:notes']=JSON.stringify([{id:'b1',title:'Calls'},{id:'b2',title:'Ideas'}]);
D['flow:settings']=JSON.stringify({displayName:'Artur',tz:'Europe/Istanbul'});
D['flow:schedule']=JSON.stringify({map:{mon:['a'],tue:['b']}});
D['flow:expenses']=JSON.stringify([{id:'e1',amt:120,receiptId:'r1'},{id:'e2',amt:40}]);
D['flow:receipt:r1']='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';
D['flow:receipt:orphan']='data:image/jpeg;base64,ORPHANORPHANORPH';
// already claimed at both levels, so only the by-name rescue can help
D['__auth:legacy_claimed']=JSON.stringify({uid,keys:4});
D['__auth:legacy_claimed_v2']=JSON.stringify({uid,keys:4});
for(const k in D) if(k.indexOf('ld_')===0) D['ld_u'+uid+':'+k]=D[k];   // ld_ side already healed
D['ld_u'+uid+':flow:profile']=JSON.stringify({marker:'newer'});         // written AFTER the fix
D['flow:profile']=JSON.stringify({marker:'older'});
D['__auth:users']=JSON.stringify({'artur.abacilar@abko.com.tr':{id:uid,
  email:'artur.abacilar@abko.com.tr',name:'Artur',salt,
  hash:hashPassword('a properly long password',salt),owner:true,created:'2026-08-03T00:00:00Z'}});
D['__auth:seed:'+uid]=JSON.stringify('legacy');
process.stdout.write(JSON.stringify(D));
