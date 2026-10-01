// Adapter for coddingtonbear/obsidian-local-rest-api's documented search API.
// This module has no write methods, vault filesystem access or MCP tool access.
import https from 'node:https';
import {Readable} from 'node:stream';
const DRAFT_PREFIX='01_DRAFTS/';
const MAX_RESPONSE_BYTES=1024*1024;
const safeDraftPath=filename=>typeof filename==='string'&&filename.startsWith(DRAFT_PREFIX)
  && filename.split('/').every(segment=>segment&&segment!=='.'&&segment!=='..'&&!segment.includes('\\'));

export class ObsidianRestError extends Error {
  constructor(code){super(code);this.code=code;}
}

function searchUrl(endpoint,query){
  let url;
  try{url=new URL(endpoint);}catch{throw new ObsidianRestError('INVALID_ENDPOINT');}
  if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/'){
    throw new ObsidianRestError('INVALID_ENDPOINT');
  }
  url.pathname='/search/simple/';
  url.searchParams.set('query',query);
  url.searchParams.set('contextLength','100');
  return url;
}

function trustedHttpsSearch(url,apiKey,caPem){
  return new Promise((resolve,reject)=>{
    const request=https.request(url,{method:'POST',headers:{authorization:`Bearer ${apiKey}`},ca:caPem,rejectUnauthorized:true,signal:AbortSignal.timeout(5000)},response=>{
      resolve({ok:response.statusCode>=200&&response.statusCode<300,body:Readable.toWeb(response)});
    });
    request.on('error',reject);
    request.end();
  });
}

export async function searchObsidianRest({endpoint,apiKey,query,caPem},{fetchImpl=fetch}={}){
  if(typeof query!=='string'||!query.trim()||query.length>200)throw new ObsidianRestError('INVALID_QUERY');
  const url=searchUrl(endpoint,query.trim());
  if(typeof apiKey!=='string'||!apiKey.trim())throw new ObsidianRestError('NOT_CONFIGURED');
  if(url.protocol==='https:'&&(!caPem||typeof caPem!=='string'))throw new ObsidianRestError('CA_NOT_CONFIGURED');
  let response;
  try{
    response=url.protocol==='https:'
      ?await trustedHttpsSearch(url,apiKey,caPem)
      :await fetchImpl(url,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(5000)});
  }catch{throw new ObsidianRestError('SEARCH_UNAVAILABLE');}
  if(!response.ok)throw new ObsidianRestError('SEARCH_HTTP_ERROR');
  let payload;
  try{
    const reader=response.body.getReader();
    const chunks=[];
    let size=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new ObsidianRestError('RESPONSE_TOO_LARGE');}
      chunks.push(value);
    }
    payload=JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  }catch(error){
    if(error instanceof ObsidianRestError)throw error;
    throw new ObsidianRestError('INVALID_RESPONSE');
  }
  if(!Array.isArray(payload))throw new ObsidianRestError('INVALID_RESPONSE');
  return payload.filter(row=>row&&safeDraftPath(row.filename))
    .slice(0,10)
    .map(row=>({
      filename:row.filename,
      score:typeof row.score==='number'&&Number.isFinite(row.score)?row.score:0,
      context:typeof row.matches?.[0]?.context==='string'?row.matches[0].context.slice(0,200):'',
    }));
}
