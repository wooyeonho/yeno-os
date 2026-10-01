import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {ownerAdmitCapabilityExchange,ownerExportCapabilityExchange,ownerSigningVault,ownerVerifyReceiptAttestation} from '../owner-signing-vault.mjs';
import {exchangeSignerId,exportCapabilityExchange} from '../lib/capability-exchange.mjs';
import {initialCapabilities,importCapability,verifyCapability,activateCapability} from '../lib/capabilities.mjs';
import {initialAbsorbInbox} from '../lib/gap-state.mjs';
import {createReceiptAttestation} from '../lib/receipt-attestation.mjs';

function fixture(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-owner-signing-'));
  // Windows can terminate the test process while a just-closed DPAPI helper
  // still holds a temporary path. Keep this isolated fixture for inspection.
  const config={version:1,dataDir:path.join(home,'data'),controlDir:path.join(home,'control'),tokenFile:path.join(home,'owner.token'),port:18790,phone:null};
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
  fs.writeFileSync(path.join(home,'provider.dpapi'),'EXISTING_PROVIDER_CIPHERTEXT');
  fs.writeFileSync(path.join(home,'connector-secrets.dpapi'),'EXISTING_SEARCH_CIPHERTEXT');
  return home;
}
function fakeCrypto(){
  return async(action,value)=>action==='Protect'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString('ascii');
}

test('owner gesture initializes isolated DPAPI vault and manages trusted public keys without disclosure',async t=>{
  const home=fixture(t),crypto=fakeCrypto(),config=fs.readFileSync(path.join(home,'config.json'),'utf8');
  assert.equal((await ownerSigningVault(home,{action:'status'},crypto)).identityStatus,'unset');
  const created=await ownerSigningVault(home,{action:'initialize'},crypto);
  assert.equal(created.identityStatus,'saved');
  assert.equal(created.trusted.length,0);
  assert.equal(created.authorizesDispatch,false);
  assert.ok(!JSON.stringify(created).includes('PRIVATE KEY'));
  await assert.rejects(()=>ownerSigningVault(home,{action:'initialize'},crypto));
  const outsider=generateKeyPairSync('ed25519'),pem=outsider.publicKey.export({format:'pem',type:'spki'}).toString();
  const trusted=await ownerSigningVault(home,{action:'trust',label:'Synthetic verifier',publicKey:pem},crypto);
  assert.deepEqual(trusted.trusted,[{label:'Synthetic verifier',signerId:exchangeSignerId(outsider.publicKey)}]);
  assert.deepEqual(await ownerSigningVault(home,{action:'status'},crypto),trusted);
  assert.deepEqual(await ownerSigningVault(home,{action:'trust',label:'Synthetic verifier',publicKey:pem},crypto),trusted);
  await assert.rejects(()=>ownerSigningVault(home,{action:'trust',label:'Changed label',publicKey:pem},crypto));
  const own=await ownerSigningVault(home,{action:'public-key'},crypto);
  await assert.rejects(()=>ownerSigningVault(home,{action:'trust',label:'Owner',publicKey:own.publicKey},crypto));
  const cleared=await ownerSigningVault(home,{action:'untrust',signerId:trusted.trusted[0].signerId},crypto);
  assert.equal(cleared.trusted.length,0);
  assert.equal(fs.readFileSync(path.join(home,'provider.dpapi'),'utf8'),'EXISTING_PROVIDER_CIPHERTEXT');
  assert.equal(fs.readFileSync(path.join(home,'connector-secrets.dpapi'),'utf8'),'EXISTING_SEARCH_CIPHERTEXT');
  assert.equal(fs.readFileSync(path.join(home,'config.json'),'utf8'),config);
  assert.ok(!fs.readFileSync(path.join(home,'signing-identity.dpapi'),'utf8').includes('PRIVATE KEY'));
});

test('invalid input and ciphertext fail closed without returning secrets',async t=>{
  const home=fixture(t),crypto=fakeCrypto();
  await assert.rejects(()=>ownerSigningVault(home,{action:'initialize',privateKey:'fake'},crypto));
  await assert.rejects(()=>ownerSigningVault(home,{action:'trust',label:'X',publicKey:'fake'},crypto));
  await ownerSigningVault(home,{action:'initialize'},crypto);
  await assert.rejects(()=>ownerSigningVault(home,{action:'trust',label:'X',publicKey:'fake'},crypto),error=>error.message==='OWNER_SIGNING_VAULT_UNAVAILABLE'&&!error.cause);
  fs.writeFileSync(path.join(home,'signing-identity.dpapi'),'broken');
  await assert.rejects(()=>ownerSigningVault(home,{action:'status'},crypto),/OWNER_SIGNING_VAULT_UNAVAILABLE/);
});

test('Windows CurrentUser DPAPI stores a synthetic identity across separate calls', {skip:process.platform!=='win32'},async t=>{
  const home=fixture(t);
  const first=await ownerSigningVault(home,{action:'initialize'});
  const second=await ownerSigningVault(home,{action:'status'});
  assert.deepEqual(first,second);
  assert.equal(second.authorizesDispatch,false);
});

test('stored owner key signs an active manifest; stored trust admits only a draft and verifies receipt bytes without external outcome claim',async t=>{
  const home=fixture(t),crypto=fakeCrypto(),outsider=generateKeyPairSync('ed25519');
  const owner=await ownerSigningVault(home,{action:'initialize'},crypto);
  const manifest=JSON.parse(fs.readFileSync(new URL('../capabilities/ledger-digest.json',import.meta.url),'utf8'));
  const at='2026-10-01T00:00:00.000Z';
  let {registry,result}=importCapability(initialCapabilities(),manifest,{at});
  registry=verifyCapability(registry,result.id,result.hash,{at}).registry;
  registry=activateCapability(registry,result.id,result.hash,{at}).registry;
  const ownerPacket=await ownerExportCapabilityExchange(home,registry,manifest.id,crypto);
  assert.equal(ownerPacket.signerId,owner.signerId);
  await assert.rejects(()=>ownerAdmitCapabilityExchange(home,initialAbsorbInbox(),ownerPacket,at,crypto));
  const packet=exportCapabilityExchange(registry,manifest.id,outsider.privateKey);
  const publicKey=outsider.publicKey.export({format:'pem',type:'spki'}).toString();
  await ownerSigningVault(home,{action:'trust',label:'Synthetic reviewer',publicKey},crypto);
  const {entry}=await ownerAdmitCapabilityExchange(home,initialAbsorbInbox(),packet,at,crypto);
  assert.equal(entry.status,'draft');assert.equal(entry.authorizesDispatch,false);
  assert.equal(entry.kind,'exchanged-capability');

  const sha=value=>createHash('sha256').update(value).digest('hex');
  const bytes=Buffer.from('synthetic receipt artifact'),artifactId=randomUUID();
  const body={format:'blackhole-mission-receipt-v1',sequence:1,previousHash:null,missionId:randomUUID(),
    createdAt:at,inputHash:sha('synthetic input'),steps:[{jobId:randomUUID(),role:'builder',status:'completed',provider:'synthetic',model:'synthetic',artifactHashes:[{artifactId,sha256:sha(bytes)}]}],
    verdict:'unverified',deterministicVerified:null,debateHashes:[],evidenceClass:'synthetic',published:false,authorizesDispatch:false};
  const receipt={...body,receiptHash:sha(JSON.stringify(body))};
  const read=id=>id===artifactId?bytes:Buffer.from('missing');
  const attestation=createReceiptAttestation(receipt,read,outsider.privateKey,at);
  const verified=await ownerVerifyReceiptAttestation(home,attestation,receipt,read,crypto);
  assert.equal(verified.receiptIntegrityVerified,true);
  assert.equal(verified.externalPersonVerified,false);
  assert.equal(verified.outcomeVerified,false);
  assert.equal(verified.highGradeCandidate,false);
  await assert.rejects(()=>ownerVerifyReceiptAttestation(home,attestation,receipt,()=>Buffer.from('tampered'),crypto));
});
