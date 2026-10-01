import {createHash,createPublicKey,sign,verify} from 'node:crypto';
import {initialCapabilities,importCapability,validateCapabilities} from './capabilities.mjs';
import {addAbsorbDraft} from './absorb-inbox.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>plain(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const b64=value=>typeof value==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(value)&&value.length<=512&&value.length>0;
export const EXCHANGE_FORMAT='blackhole-capability-exchange-v1';

export function exchangeSignerId(publicKey){
  const key=publicKey?.type==='public'?publicKey:createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 signer required');
  return digest(key.export({type:'spki',format:'der'}));
}

export function validateExchangePacket(packet){
  if(!exact(packet,['payload','signerId','signature'])||!hex(packet.signerId)||!b64(packet.signature))throw Error('Invalid exchange packet');
  const p=packet.payload;
  if(!exact(p,['format','manifest','versionHash','versions','verificationHistory','license','source'])||p.format!==EXCHANGE_FORMAT
    ||!hex(p.versionHash)||!Array.isArray(p.versions)||p.versions.length<1||p.versions.length>30
    ||!p.versions.every(v=>exact(v,['hash','version','verified'])&&hex(v.hash)&&typeof v.version==='string'&&v.version.length<=24&&typeof v.verified==='boolean')
    ||!Array.isArray(p.verificationHistory)||p.verificationHistory.length>500
    ||!p.verificationHistory.every(v=>exact(v,['at','action','hash'])&&typeof v.at==='string'&&['import','verify','activate'].includes(v.action)&&hex(v.hash))
    ||typeof p.license!=='string'||p.license.length>100||!plain(p.source))throw Error('Invalid exchange payload');
  const imported=importCapability(initialCapabilities(),p.manifest).result;
  if(imported.hash!==p.versionHash||p.license!==p.manifest.source.license||JSON.stringify(p.source)!==JSON.stringify(p.manifest.source)
    ||!p.versions.some(v=>v.hash===p.versionHash&&v.verified===true))throw Error('Exchange manifest mismatch');
  if(Buffer.byteLength(JSON.stringify(packet))>131072)throw Error('Exchange packet too large');
  return true;
}

export function exportCapabilityExchange(registry,id,privateKey){
  validateCapabilities(registry);
  if(privateKey?.type!=='private'||privateKey.asymmetricKeyType!=='ed25519')throw Error('Ed25519 private key required');
  const entry=registry.entries.find(row=>row.id===id);
  if(!entry?.activeHash)throw Error('Active capability required');
  const current=entry.versions.find(v=>v.hash===entry.activeHash);
  if(!current?.verification)throw Error('Verified active capability required');
  const payload={format:EXCHANGE_FORMAT,manifest:structuredClone(current.manifest),versionHash:current.hash,
    versions:entry.versions.map(v=>({hash:v.hash,version:v.manifest.version,verified:!!v.verification})),
    verificationHistory:registry.history.filter(h=>h.id===id&&['import','verify','activate'].includes(h.action))
      .map(h=>({at:h.at,action:h.action,hash:h.hash})),
    license:current.manifest.source.license,source:structuredClone(current.manifest.source)};
  const packet={payload,signerId:exchangeSignerId(privateKey),signature:sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64')};
  validateExchangePacket(packet);return packet;
}

export function admitCapabilityExchange(inbox,packet,trustedPublicKeys,at){
  validateExchangePacket(packet);
  if(!Array.isArray(trustedPublicKeys)||trustedPublicKeys.length===0)throw Error('Trusted signer required');
  const key=trustedPublicKeys.find(value=>exchangeSignerId(value)===packet.signerId);
  if(!key||!verify(null,Buffer.from(JSON.stringify(packet.payload)),key,Buffer.from(packet.signature,'base64')))throw Error('Exchange signature not trusted');
  return addAbsorbDraft(inbox,{kind:'exchanged-capability',payload:{packet},at,synthetic:false});
}
