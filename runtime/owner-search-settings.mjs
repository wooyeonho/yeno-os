import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite} from './lib/store.mjs';
import {residentProviderCrypto,validateResidentConfig} from './resident.mjs';

const failure=()=>new Error('OWNER_SEARCH_SETTINGS_UNAVAILABLE');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validateConnectorSecrets(value){
 if(!exact(value,['type','version','search'])||value.type!=='connectorSecrets'||value.version!==1
  ||!exact(value.search,['provider','apiKey'])||!['brave','tavily'].includes(value.search.provider)
  ||typeof value.search.apiKey!=='string'||value.search.apiKey.length<8||value.search.apiKey.length>4096
  ||/\s|[\u0000-\u001f\u007f]/u.test(value.search.apiKey))throw failure();
 return structuredClone(value);
}
function privateFile(home){
 if(typeof home!=='string'||!path.isAbsolute(home))throw failure();
 const directory=fs.lstatSync(home);if(!directory.isDirectory()||directory.isSymbolicLink())throw failure();
 const configFile=path.join(home,'config.json'),stat=fs.lstatSync(configFile);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw failure();
 const config=validateResidentConfig(JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,'')));
 const parent=path.dirname(config.tokenFile),parentStat=fs.lstatSync(parent);
 if(!parentStat.isDirectory()||parentStat.isSymbolicLink())throw failure();
 const file=path.join(parent,'connector-secrets.dpapi');
 if(fs.existsSync(file)){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>32768)throw failure();}
 return file;
}
const encoded=v=>typeof v==='string'&&v.length>0&&v.length<=32768&&v.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(v);
// Private owner pipe only. Saving does not restart, activate, test, or send a search.
export async function ownerSearchSettings(home,input,crypto=residentProviderCrypto,write=atomicWrite){
 try{
  if(!exact(input,['action'])&&!(input?.action==='save'&&exact(input,['action','provider','apiKey'])))throw failure();
  if(!['status','save'].includes(input.action))throw failure();
  const file=privateFile(home);
  if(input.action==='save'){
   const payload=validateConnectorSecrets({type:'connectorSecrets',version:1,search:{provider:input.provider,apiKey:input.apiKey}});
   const plain=Buffer.from(JSON.stringify(payload));let ciphertext;
   try{ciphertext=await crypto('Protect',plain.toString('base64'));}finally{plain.fill(0);}
   if(!encoded(ciphertext))throw failure();
   write(file,ciphertext+'\n');
  }else if(!fs.existsSync(file))return {credentialStatus:'unset',adapterStatus:'not_implemented',liveSearchVerified:false,authorizesDispatch:false};
  const ciphertext=fs.readFileSync(file,'utf8').trim();if(!encoded(ciphertext))throw failure();
  const plaintext=await crypto('Unprotect',ciphertext);if(!encoded(plaintext))throw failure();
  const buffer=Buffer.from(plaintext,'base64');try{validateConnectorSecrets(JSON.parse(buffer.toString('utf8')));}finally{buffer.fill(0);}
  return {credentialStatus:'saved',adapterStatus:'not_implemented',liveSearchVerified:false,authorizesDispatch:false};
 }catch{throw failure();}
}
