import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,createCipheriv} from 'node:crypto';
import {initialState,openStore} from '../lib/store.mjs';
import {exportBackup,restoreBackup,decryptBackup} from '../lib/backup.mjs';
import {initialGapScout,initialAbsorbInbox} from '../lib/gap-state.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-g1-migration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function legacy(){const state=initialState();delete state.gapScout;delete state.absorbInbox;state.jarvisSettings.address='기존 소유자';return state;}
function write(dir,state){const payload=JSON.stringify(state);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({format:1,sha256:hash(payload),payload}));}
// Encode the PRE-G1 envelope directly: exportBackup would migrate it first.
function oldArchive(state,key){const magic=Buffer.from('YENOBK1\n'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);const raw=Buffer.from(JSON.stringify({format:1,createdAt:new Date().toISOString(),state,artifacts:[]}));const enc=Buffer.concat([cipher.update(raw),cipher.final()]);return Buffer.concat([magic,iv,cipher.getAuthTag(),enc]);}
test('old state missing G1 fields preserves original state and gains empty collections',t=>{const dir=fixture(t),old=legacy();write(dir,old);const store=openStore(dir);assert.deepEqual(store.state,{...old,gapScout:initialGapScout(),absorbInbox:initialAbsorbInbox()});store.save();assert.deepEqual(openStore(dir).state.gapScout,initialGapScout());});
test('actual pre-G1 encrypted backup restores with safety latch and preserves old identity',t=>{const dir=fixture(t),key=randomBytes(32),old=legacy(),archive=oldArchive(old,key);const payload=decryptBackup(archive,key);assert.deepEqual(payload.state.gapScout,initialGapScout());assert.deepEqual(payload.state.absorbInbox,initialAbsorbInbox());const targetDir=path.join(dir,'restored');restoreBackup({archive,key,targetDir});const restored=openStore(targetDir).state;assert.equal(restored.jarvisSettings.address,old.jarvisSettings.address);assert.deepEqual(restored.blackholeCore.identity,old.blackholeCore.identity);assert.equal(restored.emergencyStop,true);assert.deepEqual(restored.capabilities.entries,old.capabilities.entries);});
test('new G1 keys survive encrypted roundtrip and malformed present fields fail closed',t=>{const dir=fixture(t),state=initialState(),key=randomBytes(32);const archive=exportBackup({state,dataDir:dir,key});assert.deepEqual(decryptBackup(archive,key).state.gapScout,state.gapScout);for(const keyName of ['gapScout','absorbInbox']){const invalid={...state,[keyName]:null};assert.throws(()=>exportBackup({state:invalid,dataDir:dir,key}));const target=path.join(dir,keyName);write(target,invalid);assert.throws(()=>openStore(target),/unreadable/);}});
