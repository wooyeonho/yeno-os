import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import {spawnSync} from 'node:child_process';
import {start} from '../server.mjs';
import {searchObsidianRest, ObsidianRestError} from '../lib/obsidian-rest-search.mjs';

test('read-only Obsidian search sends the documented endpoint and bounds returned snippets', async t => {
  const seen=[];
  const server=http.createServer(async (req,res)=>{
    seen.push({method:req.method,url:req.url,authorization:req.headers.authorization});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify([
      {filename:'01_DRAFTS/BLACKHOLE/test.md',score:9,matches:[{context:'A'.repeat(400),match:{start:0,end:1}}]},
      {filename:'00_INBOX_RAW/original.md',score:8,matches:[{context:'private',match:{start:0,end:7}}]},
      {filename:'01_DRAFTS/../00_INBOX_RAW/original.md',score:7,matches:[{context:'private',match:{start:0,end:7}}]},
    ]));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const result=await searchObsidianRest({endpoint:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic-key',query:'AlohaGo'});
  assert.equal(seen.length,1);
  assert.equal(seen[0].method,'POST');
  assert.equal(seen[0].url,'/search/simple/?query=AlohaGo&contextLength=100');
  assert.equal(seen[0].authorization,'Bearer synthetic-key');
  assert.deepEqual(result,[{filename:'01_DRAFTS/BLACKHOLE/test.md',score:9,context:'A'.repeat(200)}]);
});

test('Obsidian search refuses non-loopback endpoints and redirects', async () => {
  await assert.rejects(searchObsidianRest({endpoint:'https://example.com',apiKey:'x',query:'x'}),error=>error instanceof ObsidianRestError&&error.code==='INVALID_ENDPOINT');
  const fetchImpl=async()=>new Response(null,{status:302,headers:{location:'https://example.com'}});
  await assert.rejects(searchObsidianRest({endpoint:'http://127.0.0.1:27123',apiKey:'x',query:'x'},{fetchImpl}),error=>error.code==='SEARCH_HTTP_ERROR');
  const oversized=async()=>new Response('x'.repeat(1024*1024+1));
  await assert.rejects(searchObsidianRest({endpoint:'http://127.0.0.1:27123',apiKey:'x',query:'x'},{fetchImpl:oversized}),error=>error.code==='RESPONSE_TOO_LARGE');
});

test('default HTTPS plugin transport verifies an explicitly supplied local CA', async t => {
  const candidates=process.platform==='win32'
    ?['C:\\Program Files\\Git\\usr\\bin\\openssl.exe','openssl']
    :['openssl'];
  const openssl=candidates.find(candidate=>spawnSync(candidate,['version'],{stdio:'ignore'}).status===0);
  if(!openssl){t.skip('OpenSSL is unavailable for the isolated TLS fixture');return;}
  const certDir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'blackhole-obsidian-tls-'));
  const certFile=path.join(certDir,'cert.pem');
  const keyFile=path.join(certDir,'key.pem');
  t.after(()=>fs.promises.rm(certDir,{recursive:true,force:true}));
  const issued=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  assert.equal(issued.status,0,'synthetic TLS fixture creation');
  const caPem=await fs.promises.readFile(certFile,'utf8');
  const seen=[];
  const server=https.createServer({key:await fs.promises.readFile(keyFile),cert:caPem},(req,res)=>{
    seen.push({method:req.method,url:req.url,authorization:req.headers.authorization});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify([{filename:'01_DRAFTS/BLACKHOLE/live.md',score:1,matches:[{context:'local TLS search'}]}]));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const input={endpoint:`https://127.0.0.1:${server.address().port}/`,apiKey:'synthetic-key',query:'idea'};
  await assert.rejects(searchObsidianRest(input),error=>error.code==='CA_NOT_CONFIGURED');
  await assert.rejects(searchObsidianRest({...input,caPem:tls.rootCertificates[0]}),error=>error.code==='SEARCH_UNAVAILABLE');
  assert.equal(seen.length,0,'untrusted TLS must fail before sending the API key');
  const result=await searchObsidianRest({...input,caPem});
  assert.equal(seen.length,1);
  assert.deepEqual(seen[0],{method:'POST',url:'/search/simple/?query=idea&contextLength=100',authorization:'Bearer synthetic-key'});
  assert.deepEqual(result,[{filename:'01_DRAFTS/BLACKHOLE/live.md',score:1,context:'local TLS search'}]);
  const coreDir=path.join(certDir,'core');
  await fs.promises.mkdir(coreDir);
  await fs.promises.writeFile(path.join(coreDir,'obsidian-local-rest-api.crt'),caPem);
  const core=await start({host:'127.0.0.1',port:0,dataDir:coreDir,token:'synthetic-owner-token',env:{YENO_OBSIDIAN_REST_ENABLED:'true',YENO_OBSIDIAN_REST_API_KEY:'synthetic-key',YENO_OBSIDIAN_REST_ENDPOINT:input.endpoint}});
  try{
    const owner=await fetch(`http://127.0.0.1:${core.server.address().port}/api/obsidian/search?q=idea`,{headers:{authorization:'Bearer synthetic-owner-token'}});
    assert.equal(owner.status,200);
    assert.equal((await owner.json()).matches[0].filename,'01_DRAFTS/BLACKHOLE/live.md');
  }finally{
    const closed=new Promise(resolve=>core.server.once('close',resolve));
    core.shutdown();
    await closed;
  }
});

test('owner can read live draft matches while anonymous access is denied', async t => {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-obsidian-rest-'));
  const token='synthetic-owner-token';
  const env={YENO_OBSIDIAN_REST_ENABLED:'true',YENO_OBSIDIAN_REST_API_KEY:'synthetic-api-key',YENO_OBSIDIAN_REST_ENDPOINT:'http://127.0.0.1:27123/'};
  const obsidianRestFetch=async()=>new Response(JSON.stringify([{filename:'01_DRAFTS/BLACKHOLE/note.md',score:2,matches:[{context:'matching idea'}]}]),{headers:{'content-type':'application/json'}});
  const app=await start({host:'127.0.0.1',port:0,dataDir,token,env,obsidianRestFetch});
  t.after(async()=>{
    const closed=new Promise(resolve=>app.server.once('close',resolve));
    app.shutdown();
    await closed;
    await fs.promises.rm(dataDir,{recursive:true,force:true});
  });
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const anonymous=await fetch(`${base}/api/obsidian/search?q=idea`);
  assert.equal(anonymous.status,401);
  const authorized=await fetch(`${base}/api/obsidian/search?q=idea`,{headers:{authorization:`Bearer ${token}`}});
  assert.equal(authorized.status,200);
  assert.equal((await authorized.json()).matches[0].filename,'01_DRAFTS/BLACKHOLE/note.md');
  delete env.YENO_OBSIDIAN_REST_ENDPOINT;
  const withoutTrustedCa=await fetch(`${base}/api/obsidian/search?q=idea`,{headers:{authorization:`Bearer ${token}`}});
  assert.equal(withoutTrustedCa.status,502,'default HTTPS transport requires a pinned local CA');
});
