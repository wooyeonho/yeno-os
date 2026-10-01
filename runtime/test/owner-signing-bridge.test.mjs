import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('private GUI pipe exposes signing status and owner-triggered initialization without key material',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-signing-pipe-'));
  const config={version:1,dataDir:path.join(home,'data'),controlDir:path.join(home,'control'),tokenFile:path.join(home,'owner.token'),port:18790,phone:null};
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../owner-pairing.mjs',import.meta.url)),'--gui-pipe'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const requests=[{action:'signing-status',home},{action:'signing-initialize',home},{action:'signing-status',home}];
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);
  child.stderr.on('data',chunk=>stderr+=chunk);
  for(const request of requests)child.stdin.write(JSON.stringify(request)+'\n');
  child.stdin.end();
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert.equal(code,0,stderr);
  const lines=stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(lines.length,3);
  assert.deepEqual(lines.map(row=>row.identityStatus),['unset','saved','saved']);
  assert.equal(lines[1].signerId,lines[2].signerId);
  assert.ok(lines.every(row=>row.ok===true&&row.authorizesDispatch===false&&!JSON.stringify(row).includes('PRIVATE KEY')));
});
