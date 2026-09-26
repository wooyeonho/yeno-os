import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('apps/controller/dist');
const out=path.resolve('build-artifacts/acceptance-20260925');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage();
 await page.addInitScript(()=>{window.__TAURI_INTERNALS__={invoke:async(command)=>{if(command==='plugin:barcode-scanner|scan')return {content:'invalid QR'};throw new Error('Native service unavailable in browser verification');}};});
 for(const width of [375,768,1280]){
  await page.setViewportSize({width,height:900});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'PC 등록 QR 스캔'}).waitFor();
  assert.equal(await page.locator('#pairing').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`pairing-${width}.png`),fullPage:true});
 }
 await page.getByRole('button',{name:'PC 등록 QR 스캔'}).click();
 await page.locator('#message').filter({hasText:'QR 스캔을 완료하지 못했습니다'}).waitFor();
 assert.equal(await page.locator('#scan-invitation').isEnabled(),true);
 await page.screenshot({path:path.join(out,'pairing-invalid.png'),fullPage:true});
 console.log('VERIFIED browser: 375/768/1280 layouts, no owner-key field, invalid QR feedback and scan retry. Native camera not verified.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
