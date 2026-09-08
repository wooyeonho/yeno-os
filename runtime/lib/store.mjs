import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
 jobs:[], memories:[], snapshots:[], events:[], requests:{}, artifacts:{}};
}
export function openStore(directory) {
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'state.json');
 let state, recovered=false;
 const decode = file => {const envelope=JSON.parse(fs.readFileSync(file,'utf8')); if(digest(envelope.payload)!==envelope.sha256)throw new Error('checksum mismatch'); const data=JSON.parse(envelope.payload); if(!Array.isArray(data.jobs)||!Array.isArray(data.memories)||!Array.isArray(data.snapshots)||!Array.isArray(data.events)||!data.modules||!data.requests||!data.artifacts||!Number.isInteger(data.revision))throw new Error('invalid state schema'); return data;};
 if(fs.existsSync(file)) {try{state=decode(file);}catch{try{state=decode(`${file}.bak`);recovered=true;}catch{throw new Error('Both state and backup are unreadable. Original data has been preserved.');}}}
 else if(fs.existsSync(`${file}.bak`)){state=decode(`${file}.bak`);recovered=true;}
 else state=initialState();
 function save(){
   state.revision++;
   const payload=JSON.stringify(state);
   if(fs.existsSync(file)){try{decode(file); atomicWrite(`${file}.bak`,fs.readFileSync(file));}catch{}}
   atomicWrite(file,JSON.stringify({format:1,sha256:digest(payload),payload}));
 }
 return {state,save,recovered,directory};
}

export function acquireRuntimeLock(directory) {
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'runtime.lock');
 const owner={pid:process.pid,nonce:uid(),createdAt:now()};
 for(let attempt=0;attempt<2;attempt++){
   try {const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(owner));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
     return ()=>{try{const current=JSON.parse(fs.readFileSync(file,'utf8'));if(current.nonce===owner.nonce)fs.unlinkSync(file);}catch{}};
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
