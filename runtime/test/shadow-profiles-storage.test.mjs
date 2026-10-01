import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,createCipheriv} from 'node:crypto';
import {initialState,openStore} from '../lib/store.mjs';
import {decryptBackup,exportBackup,restoreBackup} from '../lib/backup.mjs';
import {initialShadowProfiles} from '../lib/shadow-profiles-state.mjs';

test('S11 old state and encrypted backup restore disabled shadow profiles before dispatch work',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s11-profiles-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const old=initialState();delete old.shadowProfiles;
  const payload=JSON.stringify(old);
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({format:1,sha256:createHash('sha256').update(payload).digest('hex'),payload}));
  const store=openStore(dir);
  assert.deepEqual(store.state.shadowProfiles,initialShadowProfiles());
  const key=randomBytes(32),magic=Buffer.from('YENOBK1\n'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(magic);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify({format:1,createdAt:new Date().toISOString(),state:old,artifacts:[]})),cipher.final()]);
  const archive=Buffer.concat([magic,iv,cipher.getAuthTag(),ciphertext]);
  assert.deepEqual(decryptBackup(archive,key).state.shadowProfiles,initialShadowProfiles());
  const target=path.join(dir,'restored');restoreBackup({archive,key,targetDir:target});
  assert.deepEqual(openStore(target).state.shadowProfiles,initialShadowProfiles());
  assert.deepEqual(decryptBackup(exportBackup({state:store.state,dataDir:dir,key}),key).state.shadowProfiles,initialShadowProfiles());
  store.state.shadowProfiles={version:1,entries:[{shadowId:'not-a-uuid',modelBinding:'local',toolScope:[],budgetShare:1}]};
  assert.throws(()=>store.save());
});
