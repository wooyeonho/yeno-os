import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {start} from '../server.mjs';

test('pre-auth HTTP serves the complete autopilot static import chain as JavaScript',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-autopilot-static-'));
  const core=await start({host:'127.0.0.1',port:0,dataDir:path.join(root,'data'),token:'synthetic-static-route-owner',env:{}});
  t.after(()=>{core.shutdown();fs.rmSync(root,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${core.server.address().port}`;
  const read=async route=>{const response=await fetch(origin+route);return {status:response.status,type:response.headers.get('content-type')??'',body:await response.text()};};
  const routes=['/app.js','/autopilot-view.mjs','/autopilot-view-engine.mjs','/capability-view.mjs'];
  const assets=Object.fromEntries(await Promise.all(routes.map(async route=>[route,await read(route)])));
  for(const route of routes){assert.equal(assets[route].status,200,`${route}: ${assets[route].status} ${assets[route].body}`);assert.match(assets[route].type,/^text\/javascript\b/,route);}
  assert.match(assets['/app.js'].body,/import\('\/autopilot-view\.mjs'\)/);
  assert.match(assets['/autopilot-view.mjs'].body,/from '\.\/autopilot-view-engine\.mjs'/);
  assert.match(assets['/autopilot-view-engine.mjs'].body,/from '\.\/capability-view\.mjs'/);
});
