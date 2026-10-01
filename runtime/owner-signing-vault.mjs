import fs from 'node:fs';
import path from 'node:path';
import {createPrivateKey,createPublicKey,generateKeyPairSync} from 'node:crypto';
import {atomicWrite} from './lib/store.mjs';
import {admitCapabilityExchange,exchangeSignerId,exportCapabilityExchange} from './lib/capability-exchange.mjs';
import {verifyReceiptAttestation} from './lib/receipt-attestation.mjs';
import {residentProviderCrypto,validateResidentConfig} from './resident.mjs';

const fail=()=>new Error('OWNER_SIGNING_VAULT_UNAVAILABLE');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
const encoded=value=>typeof value==='string'&&value.length>0&&value.length<=32768&&value.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(value);
const label=value=>typeof value==='string'&&value.length>=1&&value.length<=80&&!/[\u0000-\u001f\u007f<>]/u.test(value);

function publicKey(pem){
  if(typeof pem!=='string'||pem.length>2048)throw fail();
  const key=createPublicKey(pem);
  if(key.asymmetricKeyType!=='ed25519')throw fail();
  return key;
}

export function validateSigningVault(value){
  if(!exact(value,['version','privateKey','publicKey','trusted'])||value.version!==1
    ||typeof value.privateKey!=='string'||value.privateKey.length>4096
    ||typeof value.publicKey!=='string'||!Array.isArray(value.trusted)||value.trusted.length>30)throw fail();
  const secret=createPrivateKey(value.privateKey),identity=publicKey(value.publicKey);
  if(secret.asymmetricKeyType!=='ed25519'||exchangeSignerId(createPublicKey(secret))!==exchangeSignerId(identity))throw fail();
  const ownId=exchangeSignerId(identity),seen=new Set();
  for(const row of value.trusted){
    if(!exact(row,['label','publicKey'])||!label(row.label))throw fail();
    const id=exchangeSignerId(publicKey(row.publicKey));
    if(id===ownId||seen.has(id))throw fail();
    seen.add(id);
  }
  return value;
}

function privateFile(home){
  if(typeof home!=='string'||!path.isAbsolute(home))throw fail();
  const stat=fs.lstatSync(home);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw fail();
  const configFile=path.join(home,'config.json'),configStat=fs.lstatSync(configFile);
  if(!configStat.isFile()||configStat.isSymbolicLink()||configStat.size>32768)throw fail();
  const config=validateResidentConfig(JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,'')));
  const parent=path.dirname(config.tokenFile),parentStat=fs.lstatSync(parent);
  if(!parentStat.isDirectory()||parentStat.isSymbolicLink())throw fail();
  const file=path.join(parent,'signing-identity.dpapi');
  if(fs.existsSync(file)){
    const s=fs.lstatSync(file);
    if(!s.isFile()||s.isSymbolicLink()||s.size>32768)throw fail();
  }
  return file;
}

async function readVault(file,protect){
  const ciphertext=fs.readFileSync(file,'utf8').trim();
  if(!encoded(ciphertext))throw fail();
  const plaintext=await protect('Unprotect',ciphertext);
  if(!encoded(plaintext))throw fail();
  const buffer=Buffer.from(plaintext,'base64');
  try{return validateSigningVault(JSON.parse(buffer.toString('utf8')));}
  finally{buffer.fill(0);}
}

async function saveVault(file,vault,protect,write){
  validateSigningVault(vault);
  const plain=Buffer.from(JSON.stringify(vault));let ciphertext;
  try{ciphertext=await protect('Protect',plain.toString('base64'));}
  finally{plain.fill(0);}
  if(!encoded(ciphertext))throw fail();
  write(file,ciphertext+'\n');
}

function status(vault){
  if(!vault)return {identityStatus:'unset',signerId:null,trusted:[],authorizesDispatch:false};
  return {identityStatus:'saved',signerId:exchangeSignerId(publicKey(vault.publicKey)),
    trusted:vault.trusted.map(row=>({label:row.label,signerId:exchangeSignerId(publicKey(row.publicKey))})),authorizesDispatch:false};
}

// Called only by the private owner GUI. It never returns or logs private key bytes.
export async function ownerSigningVault(home,input,protect=residentProviderCrypto,write=atomicWrite,keyFactory=generateKeyPairSync){
  try{
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail();
    const action=input.action;
    if(!['status','initialize','trust','untrust','public-key'].includes(action))throw fail();
    if(action==='trust'?!exact(input,['action','label','publicKey']):action==='untrust'?!exact(input,['action','signerId']):!exact(input,['action']))throw fail();
    const file=privateFile(home);
    if(action==='initialize'){
      if(fs.existsSync(file))throw fail();
      const keys=keyFactory('ed25519');
      const vault={version:1,privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
        publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),trusted:[]};
      await saveVault(file,vault,protect,write);
      return status(vault);
    }
    if(!fs.existsSync(file))return action==='status'?status(null):(()=>{throw fail();})();
    const vault=await readVault(file,protect);
    if(action==='public-key')return {publicKey:vault.publicKey,signerId:exchangeSignerId(publicKey(vault.publicKey)),authorizesDispatch:false};
    if(action==='trust'){
      if(!label(input.label))throw fail();
      const key=publicKey(input.publicKey),id=exchangeSignerId(key);
      if(id===exchangeSignerId(publicKey(vault.publicKey)))throw fail();
      const current=vault.trusted.find(row=>exchangeSignerId(publicKey(row.publicKey))===id);
      if(current){if(current.label!==input.label)throw fail();return status(vault);}
      vault.trusted.push({label:input.label,publicKey:key.export({format:'pem',type:'spki'}).toString()});
      await saveVault(file,vault,protect,write);
    }else if(action==='untrust'){
      if(typeof input.signerId!=='string'||!/^[a-f0-9]{64}$/.test(input.signerId))throw fail();
      const next=vault.trusted.filter(row=>exchangeSignerId(publicKey(row.publicKey))!==input.signerId);
      if(next.length===vault.trusted.length)throw fail();
      vault.trusted=next;
      await saveVault(file,vault,protect,write);
    }
    return status(vault);
  }catch{throw fail();}
}

export async function ownerExportCapabilityExchange(home,registry,id,protect=residentProviderCrypto){
  try{
    const vault=await readVault(privateFile(home),protect);
    return exportCapabilityExchange(registry,id,createPrivateKey(vault.privateKey));
  }catch{throw fail();}
}

export async function ownerAdmitCapabilityExchange(home,inbox,packet,at,protect=residentProviderCrypto){
  try{
    const vault=await readVault(privateFile(home),protect);
    return admitCapabilityExchange(inbox,packet,vault.trusted.map(row=>publicKey(row.publicKey)),at);
  }catch{throw fail();}
}

export async function ownerVerifyReceiptAttestation(home,attestation,receipt,readArtifact,protect=residentProviderCrypto){
  try{
    const vault=await readVault(privateFile(home),protect);
    return verifyReceiptAttestation(attestation,receipt,readArtifact,{
      trustedPublicKeys:vault.trusted.map(row=>publicKey(row.publicKey)),ownerSignerId:exchangeSignerId(publicKey(vault.publicKey))});
  }catch{throw fail();}
}
