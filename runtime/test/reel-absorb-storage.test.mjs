import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createCipheriv} from 'node:crypto';
import {initialState,openStore} from '../lib/store.mjs';
import {exportBackup,decryptBackup,restoreBackup} from '../lib/backup.mjs';
import {addAbsorbDraft} from '../lib/absorb-inbox.mjs';

const at='2026-10-01T00:00:00.000Z';

test('pre-reel state and encrypted backup restore without adding a new top-level key', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-reel-legacy-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const state=initialState(),key=randomBytes(32),magic=Buffer.from('YENOBK1\n'),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);
  const payload=Buffer.concat([cipher.update(JSON.stringify({format:1,createdAt:at,state,artifacts:[]})),cipher.final()]);
  const archive=Buffer.concat([magic,iv,cipher.getAuthTag(),payload]);
  assert.deepEqual(decryptBackup(archive,key).state.absorbInbox,state.absorbInbox);
  restoreBackup({archive,key,targetDir:path.join(dir,'old')});
  assert.deepEqual(openStore(path.join(dir,'old')).state.absorbInbox,state.absorbInbox);
  assert.deepEqual(decryptBackup(exportBackup({state,dataDir:dir,key}),key).state.absorbInbox,state.absorbInbox);
});

test('new inert reel entries survive store and encrypted backup; forged verification is rejected',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-reel-new-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=openStore(dir),key=randomBytes(32);
  const claim=addAbsorbDraft(store.state.absorbInbox,{kind:'reference-claim',payload:{sourceUrl:'https://github.com/Jakubantalik/thinking-orbs',claim:'출처 미확인 주장',sharedReason:'소유자 검토',verificationStatus:'unverified'},at});
  const experiment=addAbsorbDraft(claim.inbox,{kind:'experiment',payload:{claimId:claim.entry.id,hypothesis:'조회 수를 관찰한다',metric:'fame.views',sourceType:'analytics_platform',startAt:at,verificationStatus:'unverified',observation:null},at});
  store.state.absorbInbox=experiment.inbox;store.save();
  const accepted=structuredClone(experiment.inbox);
  assert.deepEqual(openStore(dir).state.absorbInbox,accepted);
  const archive=exportBackup({state:store.state,dataDir:dir,key});
  assert.deepEqual(decryptBackup(archive,key).state.absorbInbox,accepted);
  store.state.absorbInbox.entries[0].payload.verificationStatus='verified';
  assert.throws(()=>store.save());
  assert.deepEqual(openStore(dir).state.absorbInbox,accepted);
});
