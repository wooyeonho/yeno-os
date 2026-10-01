import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomBytes,createCipheriv} from 'node:crypto';
import {initialState,openStore} from '../lib/store.mjs';
import {exportBackup,decryptBackup,restoreBackup} from '../lib/backup.mjs';
import {addAbsorbDraft} from '../lib/absorb-inbox.mjs';
import {hash} from '../lib/gap-state.mjs';
const at='2026-09-30T00:00:00.000Z';
test('C1 reuses existing inbox schema; pre-C1 backup and state roundtrip unchanged',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-c1-storage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const state=initialState(),key=randomBytes(32),magic=Buffer.from('YENOBK1\n'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({format:1,createdAt:at,state,artifacts:[]})),cipher.final()]);const archive=Buffer.concat([magic,iv,cipher.getAuthTag(),encrypted]);
 assert.deepEqual(decryptBackup(archive,key).state.absorbInbox,state.absorbInbox);
 restoreBackup({archive,key,targetDir:path.join(dir,'old')});assert.deepEqual(openStore(path.join(dir,'old')).state.driveState,state.driveState);
 state.absorbInbox=addAbsorbDraft(state.absorbInbox,{kind:'self-beautification',payload:{surface:'jarvis',evidenceSha256:hash('measurement'),finding:'horizontal overflow: 40px'},at,synthetic:true}).inbox;
 const restored=decryptBackup(exportBackup({state,dataDir:dir,key}),key).state;assert.deepEqual(restored.absorbInbox,state.absorbInbox);assert.deepEqual(restored.capabilities,state.capabilities);
});
