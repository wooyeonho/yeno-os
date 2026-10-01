import {EVIDENCE_MAX_BYTES,evidenceHash,evidenceEndpoint} from './repository-evidence-state.mjs';
const failure=(reason,known=true)=>Object.assign(Error(reason),{reason,known});
function abortable(promise,signal){
 return new Promise((resolve,reject)=>{
  const aborted=()=>reject(failure('evidence_timeout_or_stopped',false));
  if(signal.aborted)return aborted();signal.addEventListener('abort',aborted,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));
 });
}
export async function readGithubJson(url,{fetchImpl=fetch,signal,timeoutMs=12000}={}){
 if(!evidenceEndpoint(url))throw failure('evidence_host_or_path_blocked');
 const controller=new AbortController(),stop=()=>controller.abort();signal?.addEventListener('abort',stop,{once:true});
 if(signal?.aborted)stop();const timer=setTimeout(stop,timeoutMs);let response,reader;
 try{
  controller.signal.throwIfAborted();
  response=await abortable(fetchImpl(url,{method:'GET',redirect:'manual',credentials:'omit',signal:controller.signal,
   headers:{Accept:'application/vnd.github+json','Accept-Encoding':'identity','X-GitHub-Api-Version':'2026-03-10','User-Agent':'BLACKHOLE-metadata-evidence'}}),controller.signal);
  if(response.redirected||(response.url&&response.url!==url))throw failure('unexpected_redirect');
  if([301,302,303,307,308].includes(response.status))return {httpStatus:response.status,redirect:response.headers.get('location')};
  if(response.status!==200)throw Object.assign(failure([403,429].includes(response.status)?'evidence_rate_limited':'evidence_http_unavailable'),{httpStatus:response.status});
  if(!/^application\/(?:json|vnd\.github\+json)(?:;|$)/i.test(response.headers.get('content-type')??'')
   ||!['','identity'].includes(response.headers.get('content-encoding')??''))throw failure('evidence_content_type');
  const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>EVIDENCE_MAX_BYTES))throw failure('evidence_too_large');
  reader=response.body?.getReader();if(!reader)throw failure('evidence_body_missing');const chunks=[];let size=0;
  while(true){const {value,done}=await abortable(reader.read(),controller.signal);if(done)break;size+=value.length;if(size>EVIDENCE_MAX_BYTES)throw failure('evidence_too_large');chunks.push(value);}
  const bytes=Buffer.concat(chunks);let json;
  try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw failure('evidence_invalid_json');}
  return {httpStatus:200,json,sha256:evidenceHash(bytes),bodyBase64:bytes.toString('base64')};
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',stop);
  if(reader){void reader.cancel().catch(()=>{});}else if(response?.body){void response.body.cancel().catch(()=>{});}
 }
}
