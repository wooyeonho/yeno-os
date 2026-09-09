import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {decryptBackup,restoreBackup,BACKUP_MAX_ARCHIVE_BYTES} from '../runtime/lib/backup.mjs';

function readPrivate(file,maximum) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1||stat.size>maximum)throw new Error('Input must be a bounded regular file with one link');
    if(process.platform!=='win32'&&(stat.mode&0o077))throw new Error('Private input permissions must be 0600');
    const bytes=Buffer.alloc(stat.size);let offset=0;
    while(offset<bytes.length){
      const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);
      if(!count)throw new Error('Input changed during read');offset+=count;
    }
    const after=fs.fstatSync(fd);
    if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||after.nlink!==1)throw new Error('Input changed during read');
    return bytes;
  }finally{fs.closeSync(fd);}
}
function createPrivate(file,bytes) {
  const parent=path.dirname(path.resolve(file));
  if(fs.realpathSync(parent)!==parent)throw new Error('Output parent must not contain symbolic links');
  const fd=fs.openSync(file,'wx',0o600);
  try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}catch(error){fs.closeSync(fd);fs.unlinkSync(file);throw error;}
  fs.closeSync(fd);
  const directory=fs.openSync(parent,'r');
  try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
function keyFrom(file) {
  const text=readPrivate(file,128).toString('utf8').trim();
  if(!/^[a-f0-9]{64}$/i.test(text))throw new Error('Key file must contain 32 random bytes encoded as hex');
  return Buffer.from(text,'hex');
}
function parameters(argv) {
  const [command,...rest]=argv;const options={};
  for(let i=0;i<rest.length;i+=2){
    if(!/^--[a-z-]+$/.test(rest[i])||!rest[i+1]||rest[i+1].startsWith('--')||Object.hasOwn(options,rest[i]))throw new Error('Invalid or duplicate option');
    options[rest[i]]=rest[i+1];
  }
  const wanted={keygen:['--key-file'],export:['--connection-file','--key-file','--output'],verify:['--archive','--key-file'],restore:['--archive','--key-file','--target']}[command];
  if(!wanted||wanted.some(k=>!options[k])||Object.keys(options).some(k=>!wanted.includes(k)))throw new Error('Usage: keygen --key-file PATH | export --connection-file PATH --key-file PATH --output PATH | verify --archive PATH --key-file PATH | restore --archive PATH --key-file PATH --target NEW_DIRECTORY');
  return {command,options};
}
export async function main(argv=process.argv.slice(2)) {
  const {command,options:o}=parameters(argv);
  if(command==='keygen'){
    createPrivate(o['--key-file'],`${crypto.randomBytes(32).toString('hex')}\n`);
    return {created:true,type:'backup-key'};
  }
  const key=keyFrom(o['--key-file']);
  try {
    if(command==='export'){
      const connection=JSON.parse(readPrivate(o['--connection-file'],16384).toString('utf8'));
      const origin=new URL(connection.origin);
      if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||
        !(origin.protocol==='https:'||(origin.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(origin.hostname))))throw new Error('Connection requires an HTTPS origin (HTTP only on loopback)');
      if(typeof connection.pairingToken!=='string'||connection.pairingToken.length<16)throw new Error('Owner pairing credential missing from connection file');
      const response=await fetch(new URL('/api/backups/export',origin),{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
        headers:{Authorization:`Bearer ${connection.pairingToken}`,'Content-Type':'application/json'},
        body:JSON.stringify({encryptionKey:key.toString('hex')})
      });
      if(!response.ok)throw new Error(`Backup export returned HTTP ${response.status}`);
      const chunks=[];let bytes=0;
      for await(const chunk of response.body){bytes+=chunk.length;if(bytes>BACKUP_MAX_ARCHIVE_BYTES)throw new Error('Backup archive exceeds size limit');chunks.push(chunk);}
      const archive=Buffer.concat(chunks);
      const sha256=crypto.createHash('sha256').update(archive).digest('hex');
      if(response.headers.get('x-content-sha256')!==sha256)throw new Error('Download checksum mismatch');
      const backup=decryptBackup(archive,key);
      createPrivate(o['--output'],archive);
      return {exported:true,bytes,sha256,revision:backup.state.revision,artifacts:backup.artifacts.length};
    }
    const archive=readPrivate(o['--archive'],BACKUP_MAX_ARCHIVE_BYTES);
    if(command==='restore')return restoreBackup({archive,key,targetDir:o['--target']});
    const backup=decryptBackup(archive,key);
    return {verified:true,createdAt:backup.createdAt,revision:backup.state.revision,projects:backup.state.projects.length,sources:backup.state.sources.length,jobs:backup.state.jobs.length,artifacts:backup.artifacts.length};
  }finally{key.fill(0);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().then(result=>console.log(JSON.stringify(result))).catch(()=>{
    // Error objects from network/JSON parsing can contain credentials or data.
    console.error('Backup operation failed. Check options, private file permissions, owner access, archive/key validity and a new restore target. Existing core data was not overwritten.');
    process.exitCode=1;
  });
}
