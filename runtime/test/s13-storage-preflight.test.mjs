import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {initialState,openStore} from '../lib/store.mjs';
import {exportBackup,decryptBackup,restoreBackup} from '../lib/backup.mjs';
import {initialAbsorbInbox} from '../lib/gap-state.mjs';

test('S13 existing inbox state and encrypted backup restore before exchange extension',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s13-preflight-'));
  const state=initialState(),key=randomBytes(32);
  const archive=exportBackup({state,dataDir:dir,key});
  assert.deepEqual(decryptBackup(archive,key).state.absorbInbox,initialAbsorbInbox());
  const targetDir=path.join(dir,'restored');
  restoreBackup({archive,key,targetDir});
  const restored=openStore(targetDir).state;
  assert.deepEqual(restored.absorbInbox,initialAbsorbInbox());
  assert.equal(restored.emergencyStop,true);
  assert.equal(restored.capabilities.entries.length,state.capabilities.entries.length);
});
