import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash,randomBytes,createCipheriv} from 'node:crypto';
import {initialState,openStore} from '../lib/store.mjs';
import {decryptBackup,restoreBackup,exportBackup} from '../lib/backup.mjs';
import {initialShadowArise,validateShadowArise} from '../lib/shadow-arise-state.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-evidence-storage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function old(){const s=initialState();delete s.shadowArise;return s;}
function write(dir,s){const payload=JSON.stringify(s);fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({format:1,sha256:hash(payload),payload}));}
function legacyArchive(s,key){const magic=Buffer.from('YENOBK1\n'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);const enc=Buffer.concat([cipher.update(Buffer.from(JSON.stringify({format:1,createdAt:new Date().toISOString(),state:s,artifacts:[]}))),cipher.final()]);return Buffer.concat([magic,iv,cipher.getAuthTag(),enc]);}
test('pre-arise state migrates without changing old identity or existing records',t=>{const dir=fixture(t),previous=old();write(dir,previous);const store=openStore(dir);assert.deepEqual(store.state,{...previous,shadowArise:initialShadowArise()});store.save();assert.deepEqual(openStore(dir).state,store.state);});
test('actual pre-arise encrypted backup restores with safety latch and new empty evidence collection',t=>{const dir=fixture(t),key=randomBytes(32),previous=old(),raw=legacyArchive(previous,key);const read=decryptBackup(raw,key);assert.deepEqual(read.state.shadowArise,initialShadowArise());const targetDir=path.join(dir,'restored');restoreBackup({archive:raw,key,targetDir});const restored=openStore(targetDir).state;assert.deepEqual(restored.blackholeCore.identity,previous.blackholeCore.identity);assert.deepEqual(restored.gapScout,previous.gapScout);assert.equal(restored.emergencyStop,true);});
test('arise backup key is allowed; malformed present state and fabricated budgets are refused',t=>{const dir=fixture(t),key=randomBytes(32),state=initialState();assert.deepEqual(decryptBackup(exportBackup({state,dataDir:dir,key}),key).state.shadowArise,state.shadowArise);for(const bad of [null,{...initialShadowArise(),attempts:[{missionId:'invalid'}]}]){assert.throws(()=>validateShadowArise(bad));assert.throws(()=>exportBackup({state:{...state,shadowArise:bad},dataDir:dir,key}));write(dir,{...state,shadowArise:bad});assert.throws(()=>openStore(dir));}});

import {legacyShadowRoster} from './helpers/legacy-shadow-roster.mjs';
test('populated v1 shadow identities names missions and fingerprints survive old backup without recomputation',t=>{const dir=fixture(t),state=old(),key=randomBytes(32);state.shadowRoster=legacyShadowRoster();write(dir,state);assert.deepEqual(openStore(dir).state.shadowRoster,state.shadowRoster);const raw=legacyArchive(state,key),targetDir=path.join(dir,'legacy-roster');restoreBackup({archive:raw,key,targetDir});assert.deepEqual(openStore(targetDir).state.shadowRoster,state.shadowRoster);});
