import {passedMission} from '../runtime/test/helpers/shadow-mission.mjs';
import {attemptArise} from '../runtime/lib/shadow-roster.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {start} from '../runtime/server.mjs';import {openStore} from '../runtime/lib/store.mjs';
const {chromium}=createRequire(new URL('../apps/controller/package.json',import.meta.url))('playwright');
const out=path.resolve('build-artifacts/concept-20260930');fs.mkdirSync(out,{recursive:true});const dir=fs.mkdtempSync(path.join(out,'c1-core-'));const token=randomBytes(32).toString('hex');let core,browser;
try{
 browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext({viewport:{width:400,height:840},reducedMotion:'reduce'});const page=await context.newPage();
 await page.setContent('<!doctype html><html><body><div style="width:460px">synthetic overflow fixture</div></body></html>');
 const measurements=await page.evaluate(()=>[{kind:'horizontal-overflow',where:'html',scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}]);
 assert.ok(measurements[0].scrollWidth>measurements[0].clientWidth);
 const bytes=Buffer.from(JSON.stringify({version:1,surface:'jarvis',synthetic:true,measurements}));const sha256=createHash('sha256').update(bytes).digest('hex'),id=randomUUID();const store=openStore(dir);fs.mkdirSync(path.join(dir,'artifacts'),{recursive:true});fs.writeFileSync(path.join(dir,'artifacts','beauty.json'),bytes);store.state.artifacts[id]={id,name:'beauty.json',filename:'beauty.json',sha256,bytes:bytes.length,jobId:randomUUID()};const f=passedMission(),extraction=attemptArise({...store.state,jobs:f.jobs,artifacts:f.artifacts},f.missionId,f.at);store.state.shadowRoster=extraction.roster;store.state.shadowArise=extraction.shadowArise;
 fs.writeFileSync(path.join(out,'c2-arise-worthy.json'),JSON.stringify(extraction,null,2));
 const bad=passedMission();bad.jobs[4].semanticVerdict.verdict='uncertain';let failedState={...store.state,jobs:bad.jobs,artifacts:bad.artifacts};for(let i=0;i<3;i++)failedState.shadowArise=attemptArise(failedState,bad.missionId,bad.at).shadowArise;fs.writeFileSync(path.join(out,'c2-arise-failed.json'),JSON.stringify(failedState.shadowArise,null,2));store.save();
 core=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:{}});const origin=`http://127.0.0.1:${core.server.address().port}`;
 const call=async(route,data)=>{const r=await fetch(origin+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert.equal(r.status,200);return r.json();};
 const result=await call('/api/lust-mirror/inspect',{artifactIds:[id],requestId:randomUUID()});assert.equal(result.added.length,1);assert.equal((await call('/api/lust-mirror/inspect',{artifactIds:[id],requestId:randomUUID()})).added.length,0);
 await page.goto(origin+'/jarvis');await page.locator('#device-connect').click();await page.locator('#device-connect-reference').waitFor({state:'visible'});const requestId=await page.locator('#device-connect-reference').textContent();const approve=await context.request.post(origin+'/api/web/pairing/approve',{headers:{Authorization:`Bearer ${token}`,Origin:origin},data:{requestId}});assert.equal(approve.status(),200);await page.locator('#pair-screen').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('#system-notices')?.textContent.includes('나 좀 더 예뻐지고 싶어'));
 await page.locator('#control-toggle').click();await page.locator('#shadow-roster-list').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'c2-drawer.png'),fullPage:true});
 const state=await call('/api/state');assert.equal(state.drives.hunger.lust,65);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 fs.writeFileSync(path.join(out,'c2-findings.json'),JSON.stringify({evidenceClass:'SYNTHETIC_DEFECT_REAL_EDGE_AND_HTTP',...result,measurements},null,2));fs.writeFileSync(path.join(out,'c2-inbox.json'),JSON.stringify(await call('/api/absorb-inbox'),null,2));
 const roster=await call('/api/shadow-army/roster');assert.equal(roster.roster.entries.length,4);fs.writeFileSync(path.join(out,'c2-roster.json'),JSON.stringify(roster,null,2));
 await page.locator('#shadow-roster-list button').first().click();assert.match(await page.locator('#result-body').textContent(),/현재 임무 기록을 확인할 수 없습니다/);await page.locator('#result-close').click();
 const member=roster.roster.entries[0];await call('/api/shadow-army/store',{id:member.id,stored:true,requestId:randomUUID()});assert.equal((await call('/api/shadow-army/roster')).roster.entries[0].status,'stored');await call('/api/shadow-army/store',{id:member.id,stored:false,requestId:randomUUID()});
 console.log('C2 synthetic identities, actual Edge drawer and mission dialog, owner store/recall passed');
}finally{await browser?.close();core?.shutdown();core?.server.closeAllConnections();}
