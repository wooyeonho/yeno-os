import fs from 'node:fs';import path from 'node:path';
import {openStore} from '../../lib/store.mjs';
import {createRepositoryEvidence} from '../../lib/repository-evidence.mjs';
import {metadata,head,jsonResponse,at} from './repository-evidence-fixture.mjs';
process.once('message',async({dir,mode})=>{
 try{
  const store=openStore(dir);
  const verifier=createRepositoryEvidence({state:store.state,save:store.save,now:()=>at,fetchImpl:async url=>{
   fs.appendFileSync(path.join(dir,'sends.txt'),url+'\n');
   if(mode==='hang'){process.send({phase:'sent',pid:process.pid});await new Promise(()=>{});}
   return jsonResponse(url.includes('/git/ref/')?head():metadata());
  }});
  const record=await verifier.verify('https://github.com/sample/library');
  process.send({phase:'done',pid:process.pid,record,charged:store.state.repositoryEvidence.days[0]?.calls??0});process.disconnect();
 }catch{process.send({phase:'error'});process.disconnect();}
});
