import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ownerSearchSettings,validateConnectorSecrets} from '../owner-search-settings.mjs';
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-search-settings-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));const config={version:1,dataDir:path.join(home,'data'),controlDir:path.join(home,'control'),tokenFile:path.join(home,'owner.token'),port:18790,phone:null};fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));fs.writeFileSync(path.join(home,'provider.dpapi'),'EXISTING_MODEL_CIPHERTEXT');return home;}
const dummy='synthetic-not-a-real-credential';
const input={action:'save',provider:'brave',apiKey:dummy};
function fakeCrypto(){let plaintext;return async(action,value)=>{if(action==='Protect'){plaintext=value;return Buffer.from('SYNTHETIC_CIPHERTEXT').toString('base64');}return plaintext;};}
test('separate typed store preserves model file/config, status never returns secret, no network',async t=>{
 const home=fixture(t),crypto=fakeCrypto(),config=fs.readFileSync(path.join(home,'config.json'),'utf8');
 assert.equal((await ownerSearchSettings(home,{action:'status'},crypto)).credentialStatus,'unset');
 const result=await ownerSearchSettings(home,input,crypto);assert.equal(result.credentialStatus,'saved');assert.equal(result.authorizesDispatch,false);assert.equal(result.liveSearchVerified,false);
 assert.deepEqual(await ownerSearchSettings(home,{action:'status'},crypto),result);
 assert.ok(!JSON.stringify(result).includes(dummy));assert.ok(!fs.readFileSync(path.join(home,'connector-secrets.dpapi'),'utf8').includes(dummy));
 assert.equal(fs.readFileSync(path.join(home,'provider.dpapi'),'utf8'),'EXISTING_MODEL_CIPHERTEXT');assert.equal(fs.readFileSync(path.join(home,'config.json'),'utf8'),config);
});
test('wrong schemas, model payloads, corrupt ciphertext and provider reflection fail without disclosure',async t=>{
 const home=fixture(t);assert.throws(()=>validateConnectorSecrets({provider:'brave',model:'model',apiKey:dummy}));
 await assert.rejects(()=>ownerSearchSettings(home,{...input,extra:true},fakeCrypto()),/OWNER_SEARCH_SETTINGS_UNAVAILABLE/);
 await assert.rejects(()=>ownerSearchSettings(home,input,async()=>{throw Error(dummy);}),e=>e.message==='OWNER_SEARCH_SETTINGS_UNAVAILABLE'&&!e.cause);
 fs.writeFileSync(path.join(home,'connector-secrets.dpapi'),'invalid');await assert.rejects(()=>ownerSearchSettings(home,{action:'status'},fakeCrypto()));
});
test('Windows DPAPI roundtrip with dummy data survives new owner calls', {skip:process.platform!=='win32'},async t=>{
 const home=fixture(t);assert.equal((await ownerSearchSettings(home,input)).credentialStatus,'saved');
 assert.equal((await ownerSearchSettings(home,{action:'status'})).credentialStatus,'saved');
});
