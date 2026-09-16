import {validateRepositoryJob,validateJobEvidence} from './repository-patch.mjs';
import {initialCodeWorkshop,validateCodeWorkshop,disableCodeForRestore} from './code-workshop.mjs';
import {validateCodeJob} from './code-jobs.mjs';
import {validateRouting} from './brain-routing.mjs';
import {validateSelfTests} from './readiness.mjs';
import {initialCapabilities,validateCapabilities,validateCapabilityRequest,capabilityInputSha256,disableAllCapabilitiesForRestore} from './capabilities.mjs';
import {validateWorldSnapshot} from './world.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertStandaloneDirectory} from './container-lease.mjs';
import {validateProjectRegistry} from './projects.mjs';
import {validateSourceRegistry} from './sources.mjs';
import {initializeRequestLedger,validateRequestLedger} from './request-ledger.mjs';
import {initialDiscovery,validateDiscovery} from './discovery.mjs';
import {initialEcosystem,validateEcosystem} from './ecosystem.mjs';
import {validateAgentJournal} from './agent.mjs';
import {validateBotAssignment} from './project-bots.mjs';
import {validateQuestState} from './quests.mjs';
import {emptyStudio,validateStudio} from './studio.mjs';
import {initialAutopilot,validateAutopilot,validateAutopilotJob} from './autopilot.mjs';

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
 jobs:[], quests:[], outcomes:[], studio:emptyStudio(), autopilot:initialAutopilot(), capabilities:initialCapabilities(), codeWorkshop:initialCodeWorkshop(), memories:[], snapshots:[], events:[], requests:{}, requestLedger:{}, artifacts:{}, devices:{}, projects:[], sources:[], discovery:initialDiscovery(), ecosystem:initialEcosystem()};
}
function initializeQuestCollections(state) {
 // Missing collections identify older stores. Present malformed data must fail
 // validation rather than silently discarding goal or outcome evidence.
 if(!Object.hasOwn(state,'quests'))state.quests=[];
 if(!Object.hasOwn(state,'outcomes'))state.outcomes=[];
 if(!Object.hasOwn(state,'studio'))state.studio=emptyStudio();
 if(!Object.hasOwn(state,'autopilot'))state.autopilot=initialAutopilot();
 if(!Object.hasOwn(state,'capabilities'))state.capabilities=initialCapabilities();
 validateCapabilities(state.capabilities);
 if(!Object.hasOwn(state,'codeWorkshop'))state.codeWorkshop=initialCodeWorkshop();
 validateCodeWorkshop(state.codeWorkshop);
 for(const job of state.jobs){validateCodeJob(job,state.codeWorkshop);validateRepositoryJob(job);validateJobEvidence(job);}
 for(const job of state.jobs){if(job.type==='capability'){validateCapabilityRequest(job.capabilityRequest,state.capabilities);if(capabilityInputSha256(JSON.parse(job.input))!==job.capabilityRequest.inputSha256)throw new Error('Capability job input mismatch');}else if(job.capabilityRequest)throw new Error('Unexpected capability request');}
 validateAutopilot(state.autopilot);
 for(const job of state.jobs)validateAutopilotJob(job,state);
 validateStudio(state.studio);
 validateQuestState(state);
 validateSelfTests(state.selfTests);
 for(const job of state.jobs)if(job.selfTestId!==undefined&&!(state.selfTests??[]).some(item=>item.id===job.selfTestId))throw new Error('Invalid self-test job link');
 return state;
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
 // A crashed restore must never be interpreted as an empty first-run store.
 // lstat also rejects a dangling marker symlink; only completed restoration
 // removes this marker after the state and artifacts are durable.
 try {fs.lstatSync(path.join(directory,'restore-in-progress'));throw new Error('Backup restore is incomplete. Preserve this directory and restore into a new directory.');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'state.json');
 let state, recovered=false;
 const decode = file => {const envelope=JSON.parse(fs.readFileSync(file,'utf8')); if(digest(envelope.payload)!==envelope.sha256)throw new Error('checksum mismatch'); const data=JSON.parse(envelope.payload); if(!Array.isArray(data.jobs)||!Array.isArray(data.memories)||!Array.isArray(data.snapshots)||!Array.isArray(data.events)||!data.modules||!data.requests||!data.artifacts||!Number.isInteger(data.revision))throw new Error('invalid state schema');if(Object.hasOwn(data,'projects'))validateProjectRegistry(data.projects);if(Object.hasOwn(data,'sources'))validateSourceRegistry(data.sources,data.projects??[]);if(Object.hasOwn(data,'discovery'))validateDiscovery(data.discovery);if(Object.hasOwn(data,'ecosystem'))validateEcosystem(data.ecosystem);for(const job of data.jobs){if(job.worldSnapshot)validateWorldSnapshot(job.worldSnapshot);if(job.type==='world'&&job.step>=2&&!job.worldSnapshot)throw new Error('missing world checkpoint');if(job.agentJournal)validateAgentJournal(job.agentJournal);if(job.routing!==undefined)validateRouting(job.routing);validateBotAssignment(job);}initializeQuestCollections(data);sanitizeEnrollmentReceipts(data);validateRequestLedger(data);return data;};
 if(fs.existsSync(file)) {try{state=decode(file);}catch{try{state=decode(`${file}.bak`);recovered=true;}catch{throw new Error('Both state and backup are unreadable. Original data has been preserved.');}}}
 else if(fs.existsSync(`${file}.bak`)){state=decode(`${file}.bak`);recovered=true;}
 else state=initialState();
 // 0.1.1 stores predate device credentials. This additive migration preserves
 // every existing job, request receipt, artifact, and memory.
 if(!state.devices||typeof state.devices!=='object'||Array.isArray(state.devices))state.devices={};
 // Add the registry only to older stores; never replace an existing registry.
 // Project data is deliberately outside memory/settings snapshot restoration.
 if(!Object.hasOwn(state,'projects'))state.projects=[];
 // Only legacy stores without a source registry receive an empty one. A malformed
 // existing registry is a recovery error, never a reason to discard source reviews.
 if(!Object.hasOwn(state,'sources'))state.sources=[];
 if(!Object.hasOwn(state,'discovery'))state.discovery=initialDiscovery();
 if(!Object.hasOwn(state,'ecosystem'))state.ecosystem=initialEcosystem();
 initializeQuestCollections(state);
 if(recovered){state.discovery.enabled=false;state.ecosystem.enabled=false;state.autopilot.enabled=false;state.capabilities=disableAllCapabilitiesForRestore(state.capabilities).registry;state.codeWorkshop=disableCodeForRestore(state.codeWorkshop).registry;}
 // Keep accepted identities independently of the bounded response cache.
 // Existing hashes migrate unchanged; IDs evicted by older runtimes cannot
 // be reconstructed from a job alone and are not claimed as recovered.
 initializeRequestLedger(state);
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
