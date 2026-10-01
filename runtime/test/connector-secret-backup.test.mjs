import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {initialState} from '../lib/store.mjs';
import {exportBackup,decryptBackup} from '../lib/backup.mjs';

test('connector private file is excluded from backups and secret state fields are rejected',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-secret-boundary-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sentinel='SYNTHETIC_PRIVATE_FILE_NOT_A_KEY';fs.writeFileSync(path.join(dir,'connector-secrets.dpapi'),sentinel);
 const key=randomBytes(32),state=initialState(),payload=decryptBackup(exportBackup({state,dataDir:dir,key}),key);
 assert.ok(!JSON.stringify(payload).includes(sentinel));assert.ok(!JSON.stringify(payload).includes('connector-secrets.dpapi'));
 assert.throws(()=>exportBackup({state:{...state,connectorSecrets:{version:1}},dataDir:dir,key}));
});
