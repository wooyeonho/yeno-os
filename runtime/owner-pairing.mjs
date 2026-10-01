import {ownerSearchSettings} from './owner-search-settings.mjs';
import {ownerSigningVault} from './owner-signing-vault.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import QRCode from 'qrcode';
import {ownerLocalModel} from './owner-local-model.mjs';
import {ownerRemoteProvider,ownerRemoteProviderTest,ownerRemoteConnectors} from './owner-remote-provider.mjs';
import {validateResidentConfig} from './resident.mjs';

const BROWSER_REFERENCE=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export async function ownerBrowserPairing(home, id, fetchImpl=fetch) {
  if(typeof id!=='string'||!BROWSER_REFERENCE.test(id))throw new Error('INVALID_BROWSER_REFERENCE');
  const config=validateResidentConfig(JSON.parse(fs.readFileSync(path.join(home,'config.json'),'utf8').replace(/^\uFEFF/,'')));
  const token=fs.readFileSync(config.tokenFile,'utf8').replace(/^\uFEFF/,'').trim();
  const response=await fetchImpl(`http://127.0.0.1:${config.port}/api/web/pairing/approve`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify({requestId:id}),
  });
  if(response.status===410)throw new Error('BROWSER_REFERENCE_EXPIRED');
  if(!response.ok)throw new Error('BROWSER_APPROVAL_FAILED');
  const result=await response.json();
  if(result.id!==id||result.status!=='approved')throw new Error('BROWSER_APPROVAL_UNCONFIRMED');
  return {id,status:'approved'};
}

export async function ownerPairing(home, action, id, fetchImpl=fetch) {
  const config=validateResidentConfig(JSON.parse(fs.readFileSync(path.join(home,'config.json'),'utf8').replace(/^\uFEFF/,'')));
  if(!config.phone) throw new Error('PRIVATE_HTTPS_REQUIRED');
  const token=fs.readFileSync(config.tokenFile,'utf8').replace(/^\uFEFF/,'').trim();
  const requestId=id??crypto.randomUUID();
  if(!/^[a-f0-9-]{36}$/.test(requestId)||!['issue','cancel'].includes(action))throw new Error('INVALID_PAIRING_ACTION');
  const route=action==='issue'?'/api/v1/pairing/invites':`/api/v1/pairing/invites/${requestId}/cancel`;
  const response=await fetchImpl(`http://127.0.0.1:${config.port}${route}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(action==='issue'?{requestId}:{})});
  if(!response.ok)throw new Error('PAIRING_REQUEST_FAILED');
  if(action==='cancel')return {cancelled:true};
  const {invitation}=await response.json();
  if(invitation.origin!==`https://${config.phone.dnsName}:9443`)throw new Error('CORE_ORIGIN_MISMATCH');
  // Encoded image crosses only the private GUI pipe, never a terminal or file.
  const image=await QRCode.toDataURL(JSON.stringify({version:1,...invitation}),{width:360,margin:4,errorCorrectionLevel:'M'});
  return {id:invitation.id,origin:invitation.origin,expiresAt:invitation.expiresAt,image};
}

async function main() {
  if(process.argv.length!==3||process.argv[2]!=='--gui-pipe'||process.stdout.isTTY||process.stdin.isTTY)throw new Error('GUI_PIPE_REQUIRED');
  const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of input){
    let action;
    try{
      if(line.length>8192)throw new Error('INPUT_TOO_LARGE');
      const value=JSON.parse(line);
      action=value.action;
      const result=action==='approve-browser'
        ?await ownerBrowserPairing(value.home,value.id)
        :action==='signing-status'
        ?await ownerSigningVault(value.home,{action:'status'})
        :action==='signing-initialize'
        ?await ownerSigningVault(value.home,{action:'initialize'})
        :action==='signing-trust'
        ?await ownerSigningVault(value.home,{action:'trust',label:value.label,publicKey:value.publicKey})
        :action==='signing-untrust'
        ?await ownerSigningVault(value.home,{action:'untrust',signerId:value.signerId})
        :action==='signing-public-key'
        ?await ownerSigningVault(value.home,{action:'public-key'})
        :action==='connectors'
        ?await ownerRemoteConnectors(value.home,{action:'list'})
        :action==='check-connector'
        ?await ownerRemoteConnectors(value.home,{action:'check',id:value.id})
        :action==='search-settings-status'
        ?await ownerSearchSettings(value.home,{action:'status'})
        :action==='save-search-settings'
        ?await ownerSearchSettings(value.home,{action:'save',provider:value.provider,apiKey:value.apiKey})
        :action==='test-provider'
        ?await ownerRemoteProviderTest(value.home)
        :action==='save-provider'
        ?await ownerRemoteProvider(value.home,{provider:value.provider,model:value.model,apiKey:value.apiKey})
        :['models','save-model'].includes(action)?await ownerLocalModel(value.home,action,value.model):await ownerPairing(value.home,action,value.id);
      process.stdout.write(JSON.stringify({ok:true,...result})+'\n');
    }catch(error){process.stdout.write(JSON.stringify({ok:false,error:action==='approve-browser'?'브라우저 요청 번호와 10분 유효기간을 확인해 주세요.':action?.startsWith('signing-')?'서명 키·신뢰 목록을 확인하지 못했습니다. 기존 설정은 보존됩니다.':['connectors','check-connector'].includes(action)?'커넥터 상태를 확인하지 못했습니다. PC 본체 상태를 확인해 주세요.':'PC 본체와 Tailscale 사설 HTTPS 연결을 먼저 확인해 주세요.',...(action==='approve-browser'&&error.message==='BROWSER_REFERENCE_EXPIRED'?{code:'BROWSER_REFERENCE_EXPIRED'}:{})})+'\n');}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{process.stderr.write('BLACKHOLE pairing requires the private owner GUI.\n');process.exitCode=1;});
}
