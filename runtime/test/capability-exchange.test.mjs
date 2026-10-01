import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {initialCapabilities,importCapability,verifyCapability,activateCapability} from '../lib/capabilities.mjs';
import {initialAbsorbInbox} from '../lib/gap-state.mjs';
import {initialState} from '../lib/store.mjs';
import {exportBackup,decryptBackup} from '../lib/backup.mjs';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {admitCapabilityExchange,exportCapabilityExchange,validateExchangePacket} from '../lib/capability-exchange.mjs';
import {validateAbsorbInbox} from '../lib/absorb-inbox.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../capabilities/ledger-digest.json',import.meta.url),'utf8'));
const at='2026-10-01T00:00:00.000Z';
function active(){
  let {registry,result}=importCapability(initialCapabilities(),manifest,{at});
  registry=verifyCapability(registry,result.id,result.hash,{at}).registry;
  registry=activateCapability(registry,result.id,result.hash,{at}).registry;
  return registry;
}

test('S13 signed active capability enters draft inbox only; no activation or promotion',()=>{
  const keys=generateKeyPairSync('ed25519');
  const packet=exportCapabilityExchange(active(),manifest.id,keys.privateKey);
  assert.equal(validateExchangePacket(packet),true);
  const {inbox,entry}=admitCapabilityExchange(initialAbsorbInbox(),packet,[keys.publicKey],at);
  assert.equal(entry.kind,'exchanged-capability');
  assert.equal(entry.status,'draft');
  assert.equal(entry.authorizesDispatch,false);
  assert.equal(inbox.entries.length,1);
  assert.equal(validateAbsorbInbox(inbox),true);
  assert.equal(active().entries.length,1,'source registry remains separate from recipient draft');
  assert.equal(admitCapabilityExchange(inbox,packet,[keys.publicKey],at).inbox.entries.length,1);
  const state=initialState();state.absorbInbox=inbox;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s13-exchange-')),backupKey=randomBytes(32);
  assert.deepEqual(decryptBackup(exportBackup({state,dataDir:dir,key:backupKey}),backupKey).state.absorbInbox,inbox);
});

test('S13 forged signature, untrusted signer, changed manifest and unsigned input fail closed',()=>{
  const keys=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
  const packet=exportCapabilityExchange(active(),manifest.id,keys.privateKey);
  assert.throws(()=>admitCapabilityExchange(initialAbsorbInbox(),packet,[],at));
  assert.throws(()=>admitCapabilityExchange(initialAbsorbInbox(),packet,[other.publicKey],at));
  assert.throws(()=>admitCapabilityExchange(initialAbsorbInbox(),{...packet,signature:'AA=='},[keys.publicKey],at));
  assert.throws(()=>admitCapabilityExchange(initialAbsorbInbox(),{...packet,payload:{...packet.payload,license:'MIT'}},[keys.publicKey],at));
  assert.throws(()=>admitCapabilityExchange(initialAbsorbInbox(),{...packet,payload:{...packet.payload,manifest:{...packet.payload.manifest,name:'forged'}}},[keys.publicKey],at));
  assert.throws(()=>validateExchangePacket({...packet,signature:''}));
});
