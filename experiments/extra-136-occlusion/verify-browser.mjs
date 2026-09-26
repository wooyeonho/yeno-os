import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from '../../apps/controller/node_modules/playwright/index.mjs';
import {projectObject} from './scene-core.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const output=path.resolve(process.argv[2]??path.join(here,'evidence'));
const offlineFile=process.argv[3]?path.resolve(process.argv[3]):null;
if(offlineFile)assert.ok(fs.statSync(offlineFile).isFile(),'offline HTML must exist');
fs.mkdirSync(output,{recursive:true});
const allowed=new Map([['/','index.html'],['/style.css','style.css'],['/scene.mjs','scene.mjs'],['/scene-core.mjs','scene-core.mjs']]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
const server=http.createServer((req,res)=>{
  const name=allowed.get(new URL(req.url,'http://127.0.0.1').pathname);
  if(!name){res.writeHead(404);res.end();return;}
  const file=path.join(here,name);
  res.writeHead(200,{'content-type':types[path.extname(file)],'cache-control':'no-store'});
  fs.createReadStream(file).pipe(res);
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}/`;
const target=offlineFile?pathToFileURL(offlineFile).href:origin;
const report={at:new Date().toISOString(),origin:offlineFile?'offline file':'loopback ephemeral',sizes:[375,768,1280],states:['front','through','hidden','front-edge','partial-edge'],screenshots:[],checks:[],ok:false};
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of report.sizes){
    const page=await browser.newPage({viewport:{width,height:820},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(target,{waitUntil:'networkidle'});
    assert.deepEqual(errors,[],`page errors at ${width}px: ${errors.join('; ')}`);
    assert.equal(await page.locator('main').getAttribute('data-visibility'),'through');
    assert.equal(new URL(await page.locator('.source-note a').getAttribute('href')).pathname,'/reel/Dc3cNT4NWoD/');
    for(const state of ['front','through','hidden']){
      await page.locator(`[data-preset="${state}"]`).click();
      assert.equal(await page.locator('main').getAttribute('data-visibility'),state);
      assert.equal(await page.locator(`[data-preset="${state}"]`).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#rearOrb').getAttribute('hidden'),state==='through'?null:'');
      assert.equal(await page.locator('#frontOrb').getAttribute('hidden'),state==='front'?null:'');
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.mouse.move(1,1);
      await page.waitForTimeout(200);
      const screenshot=path.join(output,`scene-${width}-${state}.png`);
      await page.screenshot({path:screenshot,fullPage:true});
      const bytes=fs.readFileSync(screenshot);
      report.screenshots.push({file:path.basename(screenshot),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
      assert.equal(overflow,false,`horizontal overflow at ${width} ${state}`);
    }
    await page.locator('[data-preset="through"]').click();
    await page.locator('#position').focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('main').getAttribute('data-visibility'),'hidden');
    await page.locator('[data-preset="front"]').click();
    await page.locator('#position').focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('main').getAttribute('data-visibility'),'front');
    assert.equal(await page.locator('#frontOrb').getAttribute('hidden'),null);
    assert.equal(await page.locator('#position').evaluate(element=>getComputedStyle(element).outlineStyle),'solid');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.mouse.move(1,1);await page.waitForTimeout(200);
    const edgeShot=path.join(output,`scene-${width}-front-edge.png`);
    await page.screenshot({path:edgeShot,fullPage:true});
    const edgeBytes=fs.readFileSync(edgeShot);
    report.screenshots.push({file:path.basename(edgeShot),sha256:createHash('sha256').update(edgeBytes).digest('hex'),bytes:edgeBytes.length});
    await page.locator('[data-preset="through"]').click();
    await page.locator('#position').evaluate(element=>{element.value='78';element.dispatchEvent(new Event('input',{bubbles:true}));});
    const partial=projectObject({position:78,depth:70});
    const aperture=170*Math.sqrt(1-((partial.y-286)/200)**2);
    assert.equal(partial.visibility,'through');
    assert.ok(partial.x-partial.radius<480+aperture&&partial.x+partial.radius>480+aperture,'rear orb must cross the opening boundary');
    assert.equal(await page.locator('#rearOrb').getAttribute('hidden'),null);
    assert.equal(await page.locator('main').getAttribute('data-visibility'),'through');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.mouse.move(1,1);await page.waitForTimeout(200);
    const partialShot=path.join(output,`scene-${width}-partial-edge.png`);
    await page.screenshot({path:partialShot,fullPage:true});
    const partialBytes=fs.readFileSync(partialShot);
    report.screenshots.push({file:path.basename(partialShot),sha256:createHash('sha256').update(partialBytes).digest('hex'),bytes:partialBytes.length});
    assert.match(await page.locator('#result-title').textContent(),/안쪽/);
    assert.equal(await page.locator('#result-title').getAttribute('aria-live'),'polite');
    if(width<1024){
      await page.evaluate(()=>{const depth=document.querySelector('#depth');window.scrollTo(0,window.scrollY+depth.getBoundingClientRect().top-(innerHeight-120));});
      await page.waitForTimeout(150);
      const geometry=await page.evaluate(()=>({stage:document.querySelector('.stage-card').getBoundingClientRect().toJSON(),depth:document.querySelector('#depth').getBoundingClientRect().toJSON(),height:innerHeight}));
      assert.ok(geometry.stage.top>=0&&geometry.stage.bottom<geometry.height,`scene visible while adjusting at ${width}px`);
      assert.ok(geometry.depth.top>=geometry.stage.bottom&&geometry.depth.bottom<geometry.height,`depth control visible below scene at ${width}px`);
      const adjustShot=path.join(output,`scene-${width}-adjusting.png`);
      await page.screenshot({path:adjustShot});
      const adjustBytes=fs.readFileSync(adjustShot);
      report.screenshots.push({file:path.basename(adjustShot),sha256:createHash('sha256').update(adjustBytes).digest('hex'),bytes:adjustBytes.length});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('[data-preset="front"]').evaluate(element=>getComputedStyle(element).transitionDuration),'0s');
    assert.deepEqual(errors,[]);
    report.checks.push(`${width}px: front/through/hidden/partial-edge layers, keyboard range and focus, live text, reduced motion, source URL, no horizontal overflow, no page errors${width<1024?', preview and slider visible together':''}`);
    await page.close();
  }
  report.ok=true;
} catch(error){report.error=error.message;process.exitCode=1;}
finally{
  await browser?.close();
  server.close();await once(server,'close');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:report.ok,screenshots:report.screenshots.length,output,error:report.error??null}));
}
