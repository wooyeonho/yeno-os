// Bounded verification in the existing core container. Existing owner key and
// temporary browser cookie stay in memory; only public checks/hashes are logged.
// Does not submit model jobs, send messages, change settings or owner records.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ORIGIN='https://global-iris-gyeol-98386a17.koyeb.app';
const PREFIX='blackhole-web-20260912-v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const assert=(ok,code)=>{if(!ok)throw new Error(code);};
export async function verifyWeb({env=process.env,fetchImpl=fetch,write=console.log}={}){
  assert(typeof env.YENO_TOKEN==='string'&&env.YENO_TOKEN.length>=16,'existing_owner_key_required');
  const ownerHeaders={Authorization:`Bearer ${env.YENO_TOKEN}`};
  let cookie='',deviceId='';
  async function http(route,{body,owner=false,anonymous=false,status=200}={}){
    const response=await fetchImpl(ORIGIN+route,{method:body?'POST':'GET',headers:{...(owner?ownerHeaders:anonymous?{}:{Cookie:cookie,'X-Yeno-Browser':'1'}),...(body?{'X-Yeno-Browser':'1',Origin:ORIGIN,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const bytes=Buffer.from(await response.arrayBuffer());
    assert(response.status===status,`http_${response.status}_${route.split('?')[0]}`);
    return {response,bytes,json:()=>JSON.parse(bytes)};
  }
  const identity=items=>({count:items.length,idsSha256:hash(items.map(item=>item.id).sort().join(','))});
  const summary=s=>({collections:Object.fromEntries(['jobs','projects','sources','memories','snapshots'].map(k=>[k,identity(s[k])])),aiAttempts:s.agent.usage.attempts,aiLimit:s.agent.dailyCallLimit,automaticReviews:s.agent.automaticReviews,emergencyStop:s.emergencyStop});
  const before=(await http('/api/state',{owner:true})).json();
  const devicesBefore=(await http('/api/devices',{owner:true})).json().devices.filter(item=>!item.revokedAt);
  const report={at:new Date().toISOString(),checkId:PREFIX,origin:ORIGIN,before:summary(before),checks:[]};
  const loginId=`${PREFIX}:login`,logoutId=`${PREFIX}:logout`;
  const oldLogout=await fetchImpl(`${ORIGIN}/api/requests/${encodeURIComponent(logoutId)}`,{headers:ownerHeaders,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(oldLogout.ok){await oldLogout.arrayBuffer();write(`WEB_ALREADY_VERIFIED ${JSON.stringify({at:report.at,checkId:PREFIX,reason:'fixed logout receipt exists; no new browser enrollment or model call',state:summary(before)})}`);return;}
  assert(oldLogout.status===404,'prior_receipt_lookup_uncertain');await oldLogout.arrayBuffer();
  const loginBody={requestId:loginId,name:'BLACKHOLE web acceptance 20260912',remember:true};
  try{
    const login=await http('/api/web/session',{owner:true,body:loginBody,status:201});
    const raw=login.response.headers.getSetCookie()[0];
    assert(raw?.startsWith('__Host-yeno-web-v1='),'secure_cookie_prefix');assert(/; HttpOnly/.test(raw)&&/; Secure/.test(raw)&&/SameSite=Strict/.test(raw)&&/Max-Age=/.test(raw),'secure_cookie_attributes');
    cookie=raw.split(';')[0];const metadata=login.json();deviceId=metadata.device.id;
    assert(!login.bytes.toString().includes(env.YENO_TOKEN)&&!('deviceToken'in metadata.device),'no_raw_credentials_in_body');
    const replay=await http('/api/web/session',{owner:true,body:loginBody,status:201});assert(replay.json().device.id===deviceId,'login_replay_identity');assert(replay.response.headers.getSetCookie()[0].split(';')[0]===cookie,'login_cookie_replay');
    const session=(await http('/api/web/session')).json();assert(session.device.id===deviceId&&session.authenticated,'reopened_cookie_session');
    const state=(await http('/api/state')).json();assert(JSON.stringify(summary(state))===JSON.stringify(summary(before)),'initial_records_changed');
    report.checks.push('public HTTPS secure HttpOnly cookie, login replay and independent session read');
    await http('/api/v1/state',{status:401});await http('/api/devices',{status:403});
    const csrf=await fetchImpl(ORIGIN+'/api/control',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'stop',requestId:`${PREFIX}:must-not-run`}),redirect:'error'});await csrf.arrayBuffer();assert(csrf.status===403,'csrf_not_blocked');
    report.checks.push('cookie cannot use native or owner administration; missing Origin/header mutation blocked');
    const studio=(await http('/api/studio')).json();report.studio=Object.fromEntries(['places','contacts','checkins','series','chapters'].map(k=>[k,identity(studio[k])]));
    const capabilities=(await http('/api/capabilities')).json();report.capabilities=capabilities.capabilities.map(item=>({id:item.id,status:item.status}));
    const result=await http('/api/artifacts/0884a814-b933-49b1-bf81-3054a0811bf4');
    report.video={bytes:result.bytes.length,sha256:hash(result.bytes)};
    assert(report.video.sha256==='92d4f7ec9dce2612ca895e9649e1fed798283c137592132b30f66e17abd68bdc','prior_video_hash_changed');
    report.checks.push('existing studio collections/capabilities and exact prior MP4 readable with browser cookie');
    const manifest=(await http('/manifest.webmanifest',{anonymous:true})).json();assert(manifest.display==='standalone'&&manifest.start_url==='/','install_manifest');
    for(const icon of manifest.icons){const f=await http(icon.src,{anonymous:true});assert(f.bytes.length>100,'icon_empty');}
    for(const route of ['/web-client.mjs','/sw.js','/offline.html'])await http(route,{anonymous:true});
    report.checks.push('install manifest/icons, new client, service worker and offline page served');
    const out=(await http('/api/web/logout',{body:{requestId:logoutId,deviceId}})).json();assert(out.loggedOut&&out.revoked,'logout_not_confirmed');
    await http('/api/state',{status:401});report.checks.push('browser session revoked; prior cookie rejected');cookie='';
    const after=(await http('/api/state',{owner:true})).json();report.after=summary(after);assert(JSON.stringify(report.after)===JSON.stringify(report.before),'owner_records_or_settings_changed');
    const devicesAfter=(await http('/api/devices',{owner:true})).json().devices;
    assert(devicesBefore.every(old=>devicesAfter.some(next=>next.id===old.id&&!next.revokedAt)),'old_device_revoked');
    report.preservedActiveDevices=devicesBefore.length;report.newModelCalls=0;
    write(`WEB_VERIFIED ${JSON.stringify(report)}`);return report;
  }catch(error){
    // Revoke only this test browser when a later check fails. Never print the
    // cookie or owner bearer. Preserve all existing requests and job results.
    if(cookie&&deviceId)try{await http('/api/web/logout',{body:{requestId:logoutId,deviceId}});}catch{}
    write(`WEB_VERIFY_FAILED ${JSON.stringify({at:new Date().toISOString(),checkId:PREFIX,code:error.message})}`);throw error;
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url))verifyWeb().catch(()=>{process.exitCode=1;});
