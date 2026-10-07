import {createHash} from 'node:crypto';

export class DeveloperGatewayError extends Error {
  constructor(code,{status=null,outcome='known',payload=null}={}){super(`Developer gateway: ${code}`);this.code=code;this.status=status;this.outcome=outcome;this.payload=payload;}
}

const fail=(code,extra)=>{throw new DeveloperGatewayError(code,extra);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function createDeveloperOrderGateway({origin,token,fetchImpl=globalThis.fetch,allowInsecureLoopback=false}={}){
  let base;try{base=new URL(origin);}catch{fail('invalid_origin');}
  const loopback=['127.0.0.1','localhost','::1'].includes(base.hostname);
  if(base.username||base.password||base.search||base.hash||!['https:',...(allowInsecureLoopback&&loopback?['http:']:[])].includes(base.protocol)||!['','/'].includes(base.pathname))fail('invalid_origin');
  if(typeof token!=='string'||!token.trim()||token.length>4096||typeof fetchImpl!=='function')fail('invalid_configuration');
  const request=async(method,pathname,body,{bytes=false}={})=>{
    let response;try{response=await fetchImpl(new URL(pathname,base),{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch(error){throw new DeveloperGatewayError('transport_outcome_unknown',{outcome:'unknown',payload:{message:String(error?.message??error).slice(0,200)}});}
    if(bytes){
      if(!response.ok)fail('http_rejected',{status:response.status,payload:null});
      return{bytes:Buffer.from(await response.arrayBuffer()),sha256:response.headers.get('x-content-sha256')};
    }
    let payload;try{payload=await response.json();}catch{payload=null;}
    if(!response.ok)fail(payload?.code??'http_rejected',{status:response.status,payload});
    if(!plain(payload))fail('invalid_response');return payload;
  };
  return{
    listOrders:async()=>{const payload=await request('GET','/api/v1/developer/orders');if(!Array.isArray(payload.orders))fail('invalid_response');return payload.orders;},
    claim:(jobId,requestId)=>request('POST','/api/v1/developer/orders/claim',{requestId,jobId}),
    begin:(jobId,fence,requestId)=>request('POST','/api/v1/developer/orders/begin',{requestId,jobId,fence}),
    heartbeat:(jobId,fence,requestId)=>request('POST','/api/v1/developer/orders/heartbeat',{requestId,jobId,fence}),
    submitEvidence:(jobId,fence,evidence,requestId)=>request('POST','/api/v1/developer/evidence',{requestId,jobId,orderFence:fence,evidence}),
    fetchArtifact:async artifact=>{if(!plain(artifact)||typeof artifact.id!=='string'||!/^[a-f0-9]{64}$/.test(artifact.sha256??''))fail('invalid_artifact_reference');const result=await request('GET',`/api/v1/artifacts/${encodeURIComponent(artifact.id)}`,null,{bytes:true});const actual=createHash('sha256').update(result.bytes).digest('hex');if(actual!==artifact.sha256||result.sha256!==artifact.sha256)fail('artifact_digest_mismatch');return result.bytes;},
  };
}
