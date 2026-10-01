import {createPublicKey,verify} from 'node:crypto';

const FEATURE_SET=new Set(['channel.omnipresence','capability.exchange','runner.remote']);
const CORE_SET=new Set(['core.engine','core.verifier','core.receipts']);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const fail=()=>{throw new Error('invalid_offline_license');};
export function licensePayloadBytes(payload){
 if(!exact(payload,['schema','licenseId','signerId','issuedAt','expiresAt','features'])||payload.schema!==1||typeof payload.licenseId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(payload.licenseId)||typeof payload.signerId!=='string'||!/^[a-z0-9_-]{1,64}$/.test(payload.signerId)||!Number.isFinite(Date.parse(payload.issuedAt))||!Number.isFinite(Date.parse(payload.expiresAt))||Date.parse(payload.expiresAt)<=Date.parse(payload.issuedAt)||!Array.isArray(payload.features)||new Set(payload.features).size!==payload.features.length||payload.features.some(feature=>!FEATURE_SET.has(feature)))fail();
 return Buffer.from(JSON.stringify(payload),'utf8');
}
export function verifyOfflineLicense({payload,signature,trustedKeys,at}){
 const bytes=licensePayloadBytes(payload);
 if(!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(payload.issuedAt)||Date.parse(at)>=Date.parse(payload.expiresAt))fail();
 const pem=trustedKeys?.[payload.signerId];
 if(typeof pem!=='string'||typeof signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))fail();
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519'||!verify(null,bytes,key,Buffer.from(signature,'base64')))fail();
 return {licenseId:payload.licenseId,features:[...payload.features],validUntil:payload.expiresAt,verified:true,authorizesPayment:false};
}
export function featureEntitled(feature,verifiedLicense){
 if(CORE_SET.has(feature))return true;
 return FEATURE_SET.has(feature)&&verifiedLicense?.verified===true&&verifiedLicense.features?.includes(feature)===true;
}
