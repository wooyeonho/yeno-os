import {publicUrl} from './gap-state.mjs';
// Typed gateway contract, deliberately separate from any vendor-specific API.
// POST {query,limit} -> {results:[{title,url,snippet,...metadata}]}. A vendor URL
// alone is insufficient: the owner must explicitly select this API contract.
export function createSearchProvider(env={}, {fetchImpl=fetch}={}){
 const unavailable=reason=>({ready:false,reason,synthetic:false});
 if(!env.YENO_SEARCH_API_KEY||!env.YENO_SEARCH_BASE_URL||env.YENO_SEARCH_OFFICIAL_ENDPOINT_CONFIRMED!=='true')return unavailable('search_provider_missing');
 if(!publicUrl(env.YENO_SEARCH_BASE_URL))return unavailable('search_endpoint_invalid');
 if(env.YENO_SEARCH_API_STYLE!=='blackhole-search-v1')return unavailable('search_adapter_not_selected');
 return {ready:true,synthetic:false,async search(query,{limit,signal}){
  const combined=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
  const response=await fetchImpl(env.YENO_SEARCH_BASE_URL,{method:'POST',headers:{Authorization:`Bearer ${env.YENO_SEARCH_API_KEY}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query,limit}),redirect:'error',signal:combined});
  if(!response.ok){await response.body?.cancel().catch(()=>{});const error=Error('search_http_error');error.definite=true;error.retryable=response.status===429;throw error;}
  if(response.redirected||(response.url&&response.url!==env.YENO_SEARCH_BASE_URL)||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw Error('search_response_invalid');
  const reader=response.body?.getReader();if(!reader)throw Error('search_body_missing');
  let size=0;const chunks=[];const cancel=()=>{void reader.cancel().catch(()=>{});};combined.addEventListener('abort',cancel,{once:true});
  try{while(true){combined.throwIfAborted();const {value,done}=await reader.read();combined.throwIfAborted();if(done)break;size+=value.length;if(size>262144)throw Error('search_response_too_large');chunks.push(value);}}
  finally{combined.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
  const raw=Buffer.concat(chunks).toString('utf8');if(raw.includes(env.YENO_SEARCH_API_KEY))throw Error('search_response_rejected');
  const parsed=JSON.parse(raw);if(!Array.isArray(parsed.results)||parsed.results.length>100)throw Error('search_shape_invalid');return parsed.results;
 }};
}
