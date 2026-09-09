import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertStandaloneDirectory} from './container-lease.mjs';
import {validateProjectRegistry} from './projects.mjs';

export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  try { const dir = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(dir); fs.closeSync(dir); } catch {}
}
export function initialState() {
 return {revision:0, emergencyStop:false, concurrency:1,
 modules:{memory:true,documents:true,diagnostics:true,ai:false},
 jobs:[], memories:[], snapshots:[], events:[], requests:{}, artifacts:{}, devices:{}, projects:[]};
}
function sanitizeEnrollmentReceipts(state) {
 // Early 0.2.0 candidates cached the complete enrollment response. Preserve
 // the receipt and all other state, but never persist that raw credential.
 for(const receipt of Object.values(state.requests)){
   const device=receipt?.payload?.device;
   if(device&&typeof device==='object'&&Object.hasOwn(device,'deviceToken'))delete device.deviceToken;
 }
 return state;
}
function encodeState(state) {
 const payload=JSON.stringify(state);
 return JSON.stringify({format:1,sha256:digest(payload),payload});
}
export function openStore(directory) {
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'state.json');
 let state, recovered=false;
 const decode = file => {const envelope=JSON.parse(fs.readFileSync(file,'utf8')); if(digest(envelope.payload)!==envelope.sha256)throw new Error('checksum mismatch'); const data=JSON.parse(envelope.payload); if(!Array.isArray(data.jobs)||!Array.isArray(data.memories)||!Array.isArray(data.snapshots)||!Array.isArray(data.events)||!data.modules||!data.requests||!data.artifacts||!Number.isInteger(data.revision))throw new Error('invalid state schema');if(Object.hasOwn(data,'projects'))validateProjectRegistry(data.projects);return sanitizeEnrollmentReceipts(data);};
 if(fs.existsSync(file)) {try{state=decode(file);}catch{try{state=decode(`${file}.bak`);recovered=true;}catch{throw new Error('Both state and backup are unreadable. Original data has been preserved.');}}}
 else if(fs.existsSync(`${file}.bak`)){state=decode(`${file}.bak`);recovered=true;}
 else state=initialState();
 // 0.1.1 stores predate device credentials. This additive migration preserves
 // every existing job, request receipt, artifact, and memory.
 if(!state.devices||typeof state.devices!=='object'||Array.isArray(state.devices))state.devices={};
 // Add the registry only to older stores; never replace an existing registry.
 // Project data is deliberately outside memory/settings snapshot restoration.
 if(!Object.hasOwn(state,'projects'))state.projects=[];
 function save(){
   state.revision++;
   sanitizeEnrollmentReceipts(state);
   // Re-encode the verified previous state so legacy secrets are not copied
   // into a new backup. This does not erase older copies outside this store.
   let previous;
   for(const candidate of [file,`${file}.bak`]){
     if(!fs.existsSync(candidate))continue;
     try{previous=decode(candidate);break;}catch{}
   }
   if(previous)atomicWrite(`${file}.bak`,encodeState(previous));
   atomicWrite(file,encodeState(state));
 }
 return {state,save,recovered,directory};
}

export function acquireRuntimeLock(directory) {
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 assertStandaloneDirectory(directory);
 const file=path.join(directory,'runtime.lock');
 const owner={pid:process.pid,nonce:uid(),createdAt:now()};
 for(let attempt=0;attempt<2;attempt++){
   try {const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(owner));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
     const release=()=>{try{const current=JSON.parse(fs.readFileSync(file,'utf8'));if(current.nonce===owner.nonce)fs.unlinkSync(file);}catch{}};
     try{assertStandaloneDirectory(directory);}catch(error){release();throw error;}
     return release;
   } catch(error){
     if(error.code!=='EEXIST')throw error;
     let previous;try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Runtime lock is unreadable. Check that no YENO runtime is active before moving runtime.lock aside.');}
     if(!Number.isInteger(previous.pid)||previous.pid<1)throw new Error('Runtime lock has an invalid process ID.');
     try{process.kill(previous.pid,0);throw new Error('Another YENO runtime already owns this data directory.');}catch(probe){if(probe.code!=='ESRCH')throw probe;}
     fs.unlinkSync(file);
   }
 }
 throw new Error('Unable to acquire the runtime data lock.');
}
