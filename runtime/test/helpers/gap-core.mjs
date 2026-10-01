import fs from 'node:fs';
import path from 'node:path';
import {start} from '../../server.mjs';
import {rows} from './gap-fixture.mjs';
process.on('message',async config=>{
 try{
 const provider={ready:true,synthetic:true,search:async()=>{fs.appendFileSync(path.join(config.dir,'synthetic-sends.txt'),'sent\n');if(config.mode==='hang')await new Promise(()=>{});return rows(3);}};
 const core=await start({host:'127.0.0.1',port:0,env:{},dataDir:config.dir,token:config.token,...(config.mode==='missing'?{}:{gapSearchProvider:provider})});
 process.send({port:core.server.address().port,pid:process.pid});
 }catch{process.send({error:'isolated_core_start_failed'});process.exitCode=1;}
});
