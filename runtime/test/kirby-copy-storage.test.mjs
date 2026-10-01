import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash,randomBytes,createCipheriv} from 'node:crypto';
import {initialState,openStore} from '../lib/store.mjs';
import {decryptBackup,restoreBackup,exportBackup} from '../lib/backup.mjs';
import {initialKirby,validateKirby} from '../lib/kirby-state.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-evidence-storage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function old(){const s=initialState();delete s.kirby;return s;}
function write(dir,s){const payload=JSON.stringify(s);fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({format:1,sha256:hash(payload),payload}));}
function legacyArchive(s,key){const magic=Buffer.from('YENOBK1\n'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);const enc=Buffer.concat([cipher.update(Buffer.from(JSON.stringify({format:1,createdAt:new Date().toISOString(),state:s,artifacts:[]}))),cipher.final()]);return Buffer.concat([magic,iv,cipher.getAuthTag(),enc]);}
test('pre-kirby state migrates without changing old identity or existing records',t=>{const dir=fixture(t),previous=old();write(dir,previous);const store=openStore(dir);assert.deepEqual(store.state,{...previous,kirby:initialKirby()});store.save();assert.deepEqual(openStore(dir).state,store.state);});
test('actual pre-kirby encrypted backup restores with safety latch and new empty evidence collection',t=>{const dir=fixture(t),key=randomBytes(32),previous=old(),raw=legacyArchive(previous,key);const read=decryptBackup(raw,key);assert.deepEqual(read.state.kirby,initialKirby());const targetDir=path.join(dir,'restored');restoreBackup({archive:raw,key,targetDir});const restored=openStore(targetDir).state;assert.deepEqual(restored.blackholeCore.identity,previous.blackholeCore.identity);assert.deepEqual(restored.gapScout,previous.gapScout);assert.equal(restored.emergencyStop,true);});
test('evidence backup key is allowed; malformed present state and fabricated budgets are refused',t=>{const dir=fixture(t),key=randomBytes(32),state=initialState();assert.deepEqual(decryptBackup(exportBackup({state,dataDir:dir,key}),key).state.kirby,state.kirby);for(const bad of [null,{...initialKirby(),stars:[{capabilityId:'invalid'}]}]){assert.throws(()=>validateKirby(bad));assert.throws(()=>exportBackup({state:{...state,kirby:bad},dataDir:dir,key}));write(dir,{...state,kirby:bad});assert.throws(()=>openStore(dir));}});

