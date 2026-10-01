import {createPublicKey,verify,createHash} from 'node:crypto';

const HASH=/^[a-f0-9]{64}$/;
const VERSION=/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const fail=()=>{throw new Error('untrusted_release_manifest');};
export function releaseManifestBytes(manifest){
 if(!exact(manifest,['schema','version','platform','packageSha256','issuedAt','signerId'])||manifest.schema!==1||!VERSION.test(manifest.version)||manifest.platform!=='windows-x64'||!HASH.test(manifest.packageSha256)||!Number.isFinite(Date.parse(manifest.issuedAt))||typeof manifest.signerId!=='string'||!/^[a-z0-9_-]{1,64}$/.test(manifest.signerId))fail();
 return Buffer.from(JSON.stringify(manifest),'utf8');
}
// Verification only: no URL, download, install, task restart, or approval.
export function verifyReleaseManifest({manifest,signature,packageBytes,trustedKeys}){
 const bytes=releaseManifestBytes(manifest);
 if(!Buffer.isBuffer(packageBytes)||packageBytes.length===0||createHash('sha256').update(packageBytes).digest('hex')!==manifest.packageSha256)fail();
 const pem=trustedKeys?.[manifest.signerId];
 if(typeof pem!=='string'||typeof signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))fail();
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519'||!verify(null,bytes,key,Buffer.from(signature,'base64')))fail();
 return {version:manifest.version,platform:manifest.platform,packageSha256:manifest.packageSha256,signatureVerified:true,authorizesInstall:false};
}
