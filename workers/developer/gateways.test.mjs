import test from 'node:test';import assert from 'node:assert/strict';import {GitHubGateway,CoreGateway} from './gateways.mjs';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),T='d'.repeat(40),U='e'.repeat(40),D='f'.repeat(40);
const receipt={repository:'wooyeonho/yeno-os',branch:'blackhole/worker/demo',baseCommit:A,candidateCommit:B,baseTree:T,candidateTree:U};
function gateway(overrides={}){const writes=[];const values={
 '/git/ref/heads/blackhole/worker/demo':{object:{sha:B}},['/git/commits/'+B]:{tree:{sha:U},parents:[{sha:A}]},
 '/actions/runs/123':{head_sha:B,status:'completed',conclusion:'success',event:'push',path:'.github/workflows/developer-worker.yml'},
 '/git/ref/heads/yeno-koyeb-pilot':{object:{sha:C}},['/git/commits/'+C]:{tree:{sha:T}},...overrides};
 const g=new GitHubGateway({token:'synthetic-github-token',fetchImpl:async(url,init)=>{assert.equal(init.redirect,'error');assert.ok(url.startsWith('https://api.github.com/repos/wooyeonho/yeno-os/'));const route=url.split('/wooyeonho/yeno-os')[1];if(init.method!=='GET'){writes.push({route,method:init.method,body:JSON.parse(init.body)});return Response.json({sha:D});}if(!(route in values))throw Error('Unexpected '+route);return Response.json(values[route]);}});return {g,writes};}
const approval=()=>({receipt,approvedCommit:B,expectedProductionHead:C,verificationRunId:123});
test('operator approval binds candidate SHA, exact successful push workflow and production parent',async()=>{const {g,writes}=gateway();const r=await g.approvePromotion(approval());assert.equal(r.status,'deployment_requested_not_verified');assert.equal(r.sourceCommit,D);assert.equal(r.previousCommit,C);assert.deepEqual(writes[0].body.parents,[C,B]);assert.equal(writes[1].body.force,false);});
for(const [name,override] of [
 ['stale candidate',{'/git/ref/heads/blackhole/worker/demo':{object:{sha:C}}}],
 ['candidate tree changed',{['/git/commits/'+B]:{tree:{sha:T},parents:[{sha:A}]}}],
 ['failed CI',{'/actions/runs/123':{head_sha:B,status:'completed',conclusion:'failure',event:'push',path:'.github/workflows/developer-worker.yml'}}],
 ['wrong CI commit',{'/actions/runs/123':{head_sha:A,status:'completed',conclusion:'success',event:'push',path:'.github/workflows/developer-worker.yml'}}],
 ['wrong workflow',{'/actions/runs/123':{head_sha:B,status:'completed',conclusion:'success',event:'push',path:'.github/workflows/not-verification.yml'}}],
 ['wrong CI event',{'/actions/runs/123':{head_sha:B,status:'completed',conclusion:'success',event:'pull_request_target',path:'.github/workflows/developer-worker.yml'}}],
 ['production moved',{'/git/ref/heads/yeno-koyeb-pilot':{object:{sha:A}}}],
 ['production diverged',{['/git/commits/'+C]:{tree:{sha:U}}}],
])test('promotion blocks '+name+' before any writes',async()=>{const {g,writes}=gateway(override);await assert.rejects(()=>g.approvePromotion(approval()));assert.equal(writes.length,0);});
test('missing exact owner approval and alternate repository are rejected',async()=>{const {g,writes}=gateway();await assert.rejects(()=>g.approvePromotion({...approval(),approvedCommit:A}));assert.equal(writes.length,0);assert.throws(()=>new GitHubGateway({token:'synthetic',repository:'someone/else'}));});
test('code rollback is forward-only, exact-head-bound and not a data-restore claim',async()=>{const {g,writes}=gateway({'/git/ref/heads/yeno-koyeb-pilot':{object:{sha:D}},['/git/commits/'+C]:{tree:{sha:T}}});const r=await g.approveRollback({deployment:{sourceCommit:D,previousCommit:C,previousTree:T},approvedSourceCommit:D,expectedProductionHead:D});assert.equal(r.dataRestored,false);assert.equal(r.status,'rollback_requested_not_verified');assert.deepEqual(writes[0].body.parents,[D]);assert.equal(writes[0].body.tree,T);assert.equal(writes[1].body.force,false);});
test('core bridge rejects unsafe credential destinations and unconnected patch API',async()=>{for(const origin of ['http://example.com','https://user:pw@example.com','https://example.com/?token=x','https://example.com/api'])assert.throws(()=>new CoreGateway({origin,token:'synthetic-only-secret'}));const c=new CoreGateway({origin:'https://example.com',token:'synthetic-only-secret',fetchImpl:async()=>Response.json({emergencyStop:false,modules:{ai:true},repositoryDevelopment:{patchDrafting:false}})});await assert.rejects(()=>c.guard(),/not_deployed/);});
