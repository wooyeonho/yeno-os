import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {licensePayloadBytes,verifyOfflineLicense,featureEntitled} from '../lib/offline-license.mjs';

const keys=generateKeyPairSync('ed25519');
const other=generateKeyPairSync('ed25519');
const payload={schema:1,licenseId:'synthetic-owner-license',signerId:'owner-test',issuedAt:'2026-10-01T00:00:00.000Z',expiresAt:'2027-10-01T00:00:00.000Z',features:['channel.omnipresence','capability.exchange']};
const signature=sign(null,licensePayloadBytes(payload),keys.privateKey).toString('base64');
const trustedKeys={'owner-test':keys.publicKey.export({type:'spki',format:'pem'})};
test('only signed, unexpired premium scopes are entitled; core is never gated',()=>{
 const license=verifyOfflineLicense({payload,signature,trustedKeys,at:'2026-10-02T00:00:00.000Z'});
 assert.equal(license.authorizesPayment,false);
 assert.equal(featureEntitled('channel.omnipresence',license),true);
 assert.equal(featureEntitled('runner.remote',license),false);
 assert.equal(featureEntitled('core.engine',null),true);
 assert.equal(featureEntitled('core.verifier',null),true);
 assert.equal(featureEntitled('core.receipts',null),true);
});
test('wrong signer, altered features, expiry, and arbitrary scope are rejected',()=>{
 const input={payload,signature,trustedKeys,at:'2026-10-02T00:00:00.000Z'};
 assert.throws(()=>verifyOfflineLicense({...input,trustedKeys:{'owner-test':other.publicKey.export({type:'spki',format:'pem'})}}));
 assert.throws(()=>verifyOfflineLicense({...input,payload:{...payload,features:['runner.remote']}}));
 assert.throws(()=>verifyOfflineLicense({...input,at:'2027-10-01T00:00:00.000Z'}));
 assert.throws(()=>licensePayloadBytes({...payload,features:['core.engine']}));
});
