const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  && Object.keys(value).sort().join()===keys.slice().sort().join();
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const PROVIDERS=new Set(['local','openai','gemini','nvidia','xai','anthropic','moonshot']);
const TOOLS=new Set(['project_read','project_sources','source_read_release']);

export const initialShadowProfiles=()=>({version:1,entries:[]});
export function validateShadowProfiles(value){
  if(!exact(value,['version','entries'])||value.version!==1||!Array.isArray(value.entries)||value.entries.length>5000)throw Error('Invalid shadow profiles');
  const seen=new Set();
  for(const row of value.entries){
    if(!exact(row,['shadowId','modelBinding','toolScope','budgetShare'])||!uuid(row.shadowId)||seen.has(row.shadowId)
      ||!(row.modelBinding===null||PROVIDERS.has(row.modelBinding))||!Array.isArray(row.toolScope)
      ||row.toolScope.length>TOOLS.size||new Set(row.toolScope).size!==row.toolScope.length
      ||row.toolScope.some(tool=>!TOOLS.has(tool))||!Number.isInteger(row.budgetShare)
      ||row.budgetShare<1||row.budgetShare>4)throw Error('Invalid shadow profile');
    seen.add(row.shadowId);
  }
  return true;
}
