export const repo='sample/library';
export const at='2026-09-30T02:00:00.000Z';
export const metadata=(overrides={})=>({id:42,full_name:repo,name:'library',owner:{login:'sample'},private:false,license:{spdx_id:'MIT'},archived:false,disabled:false,default_branch:'main',pushed_at:'2026-09-29T03:00:00Z',stargazers_count:7,...overrides});
export const head=(overrides={})=>({ref:'refs/heads/main',object:{type:'commit',sha:'a'.repeat(40)},...overrides});
export const jsonResponse=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
export function fakeGithub(overrides={},requests=[]){return async(url,options)=>{requests.push({url,options});return jsonResponse(url.includes('/git/ref/')?head():metadata(overrides));};}
