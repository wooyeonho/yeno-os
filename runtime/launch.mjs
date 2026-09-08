import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {start} from './server.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
let runtime,proxy,stopping=false;
function stop(){if(stopping)return;stopping=true;proxy?.kill('SIGTERM');runtime?.shutdown();setTimeout(()=>process.exit(0),300).unref();}
function readConfig(){
  const file=path.join(root,'config.local.json');if(!fs.existsSync(file))return;
  const c=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!c||typeof c!=='object'||Array.isArray(c))throw new Error('config.local.json must contain a JSON object');
  if(c.port!==undefined){if(!Number.isInteger(c.port)||c.port<1024||c.port>65535)throw new Error('port must be 1024..65535');process.env.YENO_PORT??=String(c.port);}
  if(c.allowedHosts!==undefined){if(!Array.isArray(c.allowedHosts)||!c.allowedHosts.every(x=>typeof x==='string'&&/^[a-zA-Z0-9.:-]+$/.test(x)))throw new Error('allowedHosts must be an array of hostnames');process.env.YENO_ALLOWED_HOSTS??=c.allowedHosts.join(',');}
  if(c.ai!==undefined){for(const [name,key]of [['baseUrl','YENO_AI_BASE_URL'],['model','YENO_AI_MODEL'],['apiKey','YENO_AI_API_KEY']]){if(c.ai[name]!==undefined&&typeof c.ai[name]!=='string')throw new Error(`ai.${name} must be text`);if(c.ai[name])process.env[key]??=c.ai[name];}}
}
function tailscalePath(){
  const candidates=process.platform==='win32'?[path.join(process.env.ProgramFiles||'C:\\Program Files','Tailscale','tailscale.exe'),'tailscale.exe']:['tailscale'];
  for(const file of candidates){const p=spawnSync(file,['version'],{encoding:'utf8',timeout:5000,windowsHide:true});if(!p.error&&p.status===0)return file;}
  throw new Error('Tailscale is not installed. Follow PHONE_SETUP.md, then run this launcher again.');
}
try{
  if(Number(process.versions.node.split('.')[0])<20)throw new Error('Node.js 20 or later is required.');
  readConfig();
  const phone=process.argv.includes('--phone');let ts,phoneURL;
  if(phone){
    ts=tailscalePath();const p=spawnSync(ts,['status','--json'],{encoding:'utf8',timeout:10000,windowsHide:true});
    if(p.error||p.status!==0)throw new Error('Tailscale status could not be read. Open the Tailscale app and connect first.');
    const s=JSON.parse(p.stdout);if(s.BackendState!=='Running')throw new Error('Sign in and connect in the Tailscale app first.');
    const dns=String(s.Self?.DNSName||'').replace(/\.$/,'');if(!/^[a-z0-9][a-z0-9.-]+\.ts\.net$/i.test(dns))throw new Error('A Tailscale DNS name is not available. Check MagicDNS in Tailscale.');
    const served=spawnSync(ts,['serve','status','--json'],{encoding:'utf8',timeout:10000,windowsHide:true});
    if(served.error||served.status!==0)throw new Error('Cannot inspect existing Tailscale Serve configuration. Check PHONE_SETUP.md.');
    const existing=JSON.parse(served.stdout||'{}');
    if(existing.TCP?.['9443']||JSON.stringify(existing).includes(`${dns}:9443`))throw new Error('Tailscale port 9443 already has a configuration. It was left unchanged. See PHONE_SETUP.md.');
    process.env.YENO_ALLOWED_HOSTS=[process.env.YENO_ALLOWED_HOSTS,`${dns}:9443`].filter(Boolean).join(',');phoneURL=`https://${dns}:9443`;
  }
  runtime=await start({host:'127.0.0.1'});const address=runtime.server.address();const url=`http://127.0.0.1:${address.port}`;
  console.log('\nYENO OS 0.1.1 — LOCAL RUNTIME\n');console.log(`PC: ${url}`);console.log(`PAIRING TOKEN: ${runtime.token}`);console.log('\nPaste the pairing token in your YENO browser. Keep this window open.');
  if(phone){console.log(`\nPHONE: ${phoneURL}`);console.log('Complete any HTTPS setup prompt in Tailscale. This shares only inside your personal Tailscale network.');proxy=spawn(ts,['serve','--https=9443',url],{stdio:'inherit'});proxy.on('error',()=>console.error('Phone proxy could not start. PC mode remains available.'));proxy.on('exit',code=>{if(!stopping)console.log(`Phone proxy stopped (${code ?? 'signal'}). PC mode remains available.`);});}
  if(!process.argv.includes('--no-open')&&process.platform==='win32'){const b=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true});b.on('error',()=>console.log('Open the PC URL above in your browser.'));b.unref();}
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
}catch(e){runtime?.shutdown();console.error(`YENO could not start: ${e.message}`);process.exitCode=1;}
