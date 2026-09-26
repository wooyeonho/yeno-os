import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import QRCode from 'qrcode';
import {ownerLocalModel} from './owner-local-model.mjs';
import {validateResidentConfig} from './resident.mjs';

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
    try{
      if(line.length>4096)throw new Error('INPUT_TOO_LARGE');
      const value=JSON.parse(line);
      const result=['models','save-model'].includes(value.action)?await ownerLocalModel(value.home,value.action,value.model):await ownerPairing(value.home,value.action,value.id);
      process.stdout.write(JSON.stringify({ok:true,...result})+'\n');
    }catch{process.stdout.write(JSON.stringify({ok:false,error:'PC 본체와 Tailscale 사설 HTTPS 연결을 먼저 확인해 주세요.'})+'\n');}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{process.stderr.write('BLACKHOLE pairing requires the private owner GUI.\n');process.exitCode=1;});
}
