import {stateWithGap,rows,at} from '../runtime/test/helpers/gap-fixture.mjs';
import {createGapScout} from '../runtime/lib/gap-scout.mjs';
import {addAbsorbDraft} from '../runtime/lib/absorb-inbox.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {start} from '../runtime/server.mjs';import {openStore} from '../runtime/lib/store.mjs';
const {chromium}=createRequire(new URL('../apps/controller/package.json',import.meta.url))('playwright');
const out=path.resolve('build-artifacts/concept-20260930');fs.mkdirSync(out,{recursive:true});const dir=fs.mkdtempSync(path.join(out,'c1-core-'));const token=randomBytes(32).toString('hex');let core,browser;
try{
 browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext({viewport:{width:400,height:840},reducedMotion:'reduce'});const page=await context.newPage();
 await page.setContent('<!doctype html><html><body><div style="width:460px">synthetic overflow fixture</div></body></html>');
 const measurements=await page.evaluate(()=>[{kind:'horizontal-overflow',where:'html',scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}]);
 assert.ok(measurements[0].scrollWidth>measurements[0].clientWidth);
 const bytes=Buffer.from(JSON.stringify({version:1,surface:'jarvis',synthetic:true,measurements}));const sha256=createHash('sha256').update(bytes).digest('hex'),id=randomUUID();const store=openStore(dir);fs.mkdirSync(path.join(dir,'artifacts'),{recursive:true});fs.writeFileSync(path.join(dir,'artifacts','beauty.json'),bytes);store.state.artifacts[id]={id,name:'beauty.json',filename:'beauty.json',sha256,bytes:bytes.length,jobId:randomUUID()};const fixture=stateWithGap();const scout=createGapScout({state:fixture,save(){},now:()=>at,provider:{ready:true,synthetic:true,search:async()=>rows(1)}});await scout.researchGap(fixture.gapScout.gaps[0].id,'c3-search');store.state.gapScout=fixture.gapScout;store.state.absorbInbox=fixture.absorbInbox;store.state.driveDebates=fixture.driveDebates;
 for(let i=0;i<3;i++)store.state.absorbInbox=addAbsorbDraft(store.state.absorbInbox,{kind:'self-beautification',payload:{surface:'jarvis',evidenceSha256:sha256,finding:'synthetic test '+i},at,synthetic:true}).inbox;store.save();
 core=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:{}});const origin=`http://127.0.0.1:${core.server.address().port}`;
 const call=async(route,data)=>{const r=await fetch(origin+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert.equal(r.status,200);return r.json();};
 const result=await call('/api/lust-mirror/inspect',{artifactIds:[id],requestId:randomUUID()});assert.equal(result.added.length,1);assert.equal((await call('/api/lust-mirror/inspect',{artifactIds:[id],requestId:randomUUID()})).added.length,0);
 const box=await call('/api/absorb-inbox');const research=box.entries.find(e=>e.kind==='research-draft');const manifest=JSON.parse(fs.readFileSync('runtime/capabilities/ledger-digest.json','utf8'));manifest.source.url=research.payload.candidate.url;manifest.source.license=research.payload.candidate.license;
 for(const entry of box.entries)await call('/api/kirby/inhale',{inboxId:entry.id,requestId:randomUUID(),...(entry.id===research.id?{manifest}:{})});
 const before=await call('/api/kirby');assert.ok(!before.abilities.some(a=>a.id===manifest.id));await call('/api/capabilities/activate',{id:manifest.id,requestId:randomUUID()});await call('/api/kirby/equip',{id:manifest.id,requestId:randomUUID()});
 const after=await call('/api/absorb-inbox');assert.equal(after.entries.filter(e=>e.status==='noAbility').length,4);fs.writeFileSync(path.join(out,'c3-inhale.json'),JSON.stringify(after,null,2));fs.writeFileSync(path.join(out,'c3-abilities.json'),JSON.stringify(await call('/api/kirby'),null,2));
 await page.goto(origin+'/jarvis');await page.locator('#device-connect').click();await page.locator('#device-connect-reference').waitFor({state:'visible'});const requestId=await page.locator('#device-connect-reference').textContent();const approve=await context.request.post(origin+'/api/web/pairing/approve',{headers:{Authorization:`Bearer ${token}`,Origin:origin},data:{requestId}});assert.equal(approve.status(),200);await page.locator('#pair-screen').waitFor({state:'hidden'});
 await page.locator('#kirby-hat').waitFor({state:'visible'});
 await page.screenshot({path:path.join(out,'c3-topbar.png'),fullPage:true});
 const state=await call('/api/state');assert.equal(state.drives.hunger.lust,65);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 fs.writeFileSync(path.join(out,'c3-findings.json'),JSON.stringify({evidenceClass:'SYNTHETIC_DEFECT_REAL_EDGE_AND_HTTP',...result,measurements},null,2));fs.writeFileSync(path.join(out,'c3-inbox.json'),JSON.stringify(await call('/api/absorb-inbox'),null,2));
 console.log('C3 five inhales, four noAbility, owner activation, one equipped hat visible in Edge passed');
}finally{await browser?.close();core?.shutdown();core?.server.closeAllConnections();}
