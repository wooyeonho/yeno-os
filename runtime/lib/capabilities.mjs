import crypto from 'node:crypto';
export class CapabilityError extends Error {constructor(status,message,code='CAPABILITY_INVALID'){super(message);this.status=status;this.code=code;this.extra={code};}}
const fail=(message,status=400)=>{throw new CapabilityError(status,message);};
const ID=/^[a-z][a-z0-9-]{1,63}$/,HASH=/^[a-f0-9]{64}$/,VERSION=/^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const stamp=options=>options?.at??new Date().toISOString();
const exact=(v,keys)=>obj(v)&&Object.keys(v).sort().join() === keys.slice().sort().join();
function safeTree(v,depth=0){
 if(depth>12)fail('입력 구조가 너무 깊습니다.');
 if(v===null||typeof v==='boolean')return;
 if(typeof v==='number'){if(!Number.isFinite(v))fail('유한한 숫자가 필요합니다.');return;}
 if(typeof v==='string'){if(v.length>20000)fail('텍스트가 너무 깁니다.');return;}
 if(Array.isArray(v)){if(v.length>500)fail('행은500개 이하로 입력하세요.');for(const x of v)safeTree(x,depth+1);return;}
 if(!obj(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('일반 JSON 값이 필요합니다.');
 if(Object.keys(v).length>40)fail('필드가 너무 많습니다.');
 for(const [k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail('허용하지 않는 필드입니다.');safeTree(x,depth+1);}
}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(obj(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function bounded(v){safeTree(v);if(Buffer.byteLength(canonical(v))>65536)fail('입력은64KB 이하로 줄여 주세요.');}
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
export function capabilityInputSha256(input){bounded(input);return hash(input);}
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
function validateManifest(m){
 bounded(m);
 if(!exact(m,['schemaVersion','id','version','name','description','source','inputSchema','steps','output','fixtures'])||m.schemaVersion!==1||!ID.test(m.id)||!VERSION.test(m.version)||!text(m.name,100)||!text(m.description,600))fail('기능 파일의 이름·버전·형식을 확인하세요.');
 if(!exact(m.source,['kind','author','license','url'])||!['native','owner','external'].includes(m.source.kind)||!text(m.source.author,100)||!text(m.source.license,100)||typeof m.source.url!=='string')fail('출처·작성자·이용 조건이 필요합니다.');
 if(m.source.url){let url;try{url=new URL(m.source.url);}catch{fail('출처 주소가 올바르지 않습니다.');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail('출처에는 비밀값이나 주소 매개변수를 넣지 마세요.');}
 if(m.source.kind==='external'&&!m.source.url)fail('외부 기능은 원본 출처 주소가 필요합니다.');
 if(!exact(m.inputSchema,['fields'])||!obj(m.inputSchema.fields)||!Object.keys(m.inputSchema.fields).length||Object.keys(m.inputSchema.fields).length>12||Object.entries(m.inputSchema.fields).some(([k,v])=>!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)||!['string','number','boolean'].includes(v)))fail('입력 필드 형식이 올바르지 않습니다.');
 const fields=Object.keys(m.inputSchema.fields);
 if(!Array.isArray(m.steps)||m.steps.length>12)fail('기능 단계가 너무 많습니다.');
 for(const step of m.steps){
  if(step.op==='filter'){if(!exact(step,['op','field','operator','value'])||!fields.includes(step.field)||!['eq','lte','gte','in'].includes(step.operator))fail('허용한 필터만 사용할 수 있습니다.');if(step.operator==='in'){if(!Array.isArray(step.value)||step.value.length>20||step.value.some(v=>typeof v!==m.inputSchema.fields[step.field]))fail('필터 값 형식을 확인하세요.');}else if(typeof step.value!==m.inputSchema.fields[step.field])fail('필터 값 형식을 확인하세요.');if(['lte','gte'].includes(step.operator)&&m.inputSchema.fields[step.field]!=='number')fail('비교 필터에는 숫자가 필요합니다.');}
  else if(step.op==='sort'){if(!exact(step,['op','field','direction'])||!fields.includes(step.field)||!['asc','desc'].includes(step.direction))fail('정렬 형식을 확인하세요.');}
  else if(step.op==='limit'){if(!exact(step,['op','count'])||!Number.isInteger(step.count)||step.count<1||step.count>100)fail('출력 행 제한은1~100입니다.');}
  else fail('이 기능 형식은 필터·정렬·행 제한만 실행합니다. 코드와 명령은 실행하지 않습니다.');
 }
 if(!exact(m.output,['title','description','columns','footer'])||!text(m.output.title,160)||typeof m.output.description!=='string'||m.output.description.length>1000||typeof m.output.footer!=='string'||m.output.footer.length>1000||!Array.isArray(m.output.columns)||m.output.columns.length<1||m.output.columns.length>12||m.output.columns.some(c=>!exact(c,['field','label'])||!fields.includes(c.field)||!text(c.label,80)))fail('출력 표 형식을 확인하세요.');
 if(!Array.isArray(m.fixtures)||m.fixtures.length<2||m.fixtures.length>8)fail('서로 다른 시험 입력을2~8개 포함하세요.');
 if(new Set(m.fixtures.map(f=>hash(f.input))).size!==m.fixtures.length)fail('서로 다른 시험 입력이 필요합니다.');
 for(const f of m.fixtures){if(!exact(f,['name','input','expectedRows'])||!text(f.name,100)||!Array.isArray(f.expectedRows))fail('시험의 입력과 예상 결과가 필요합니다.');validateInput(m,f.input);for(const row of f.expectedRows)validateRow(m,row);}
 return true;
}
function validateRow(m,row){if(!exact(row,Object.keys(m.inputSchema.fields)))fail('필요한 입력 필드를 모두 입력하세요.');for(const [key,type]of Object.entries(m.inputSchema.fields))if(typeof row[key]!==type||(type==='number'&&!Number.isFinite(row[key]))||(type==='string'&&row[key].length>2000))fail('입력 값의 형식이나 길이를 확인하세요.');}
function validateInput(m,input){bounded(input);if(!exact(input,['records'])||!Array.isArray(input.records))fail('records 목록이 필요합니다.');for(const row of input.records)validateRow(m,row);}
function transform(m,input){
 validateInput(m,input);let rows=structuredClone(input.records);
 for(const step of m.steps){if(step.op==='filter')rows=rows.filter(r=>step.operator==='eq'?r[step.field]===step.value:step.operator==='in'?step.value.includes(r[step.field]):step.operator==='lte'?r[step.field]<=step.value:r[step.field]>=step.value);else if(step.op==='sort')rows.sort((a,b)=>(a[step.field]===b[step.field]?0:a[step.field]<b[step.field]?-1:1)*(step.direction==='asc'?1:-1));else rows=rows.slice(0,step.count);}
 return rows.slice(0,100);
}
const clean=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
function render(m,rows){const o=m.output;const body=`# ${clean(o.title)}\n\n${clean(o.description)}\n\n| ${o.columns.map(c=>clean(c.label)).join(' | ')} |\n| ${o.columns.map(()=> '---').join(' | ')} |\n${rows.map(r=>'| '+o.columns.map(c=>clean(r[c.field])).join(' | ')+' |').join('\n')}\n\n${rows.length?'':'조건에 해당하는 항목이 없습니다.\n\n'}${clean(o.footer)}\n`;if(Buffer.byteLength(body)>240*1024)fail('결과가 너무 큽니다. 출력 행 수를 줄여 주세요.');return body;}
function fixtures(m){validateManifest(m);for(const f of m.fixtures){if(canonical(transform(m,f.input))!==canonical(f.expectedRows))fail(`시험 실패: ${f.name}`,409);render(m,f.expectedRows);}return {engine:'declarative-v1',passed:m.fixtures.length};}
export function initialCapabilities(){return {version:1,entries:[],history:[]};}
export function validateCapabilities(r){
 if(!exact(r,['version','entries','history'])||r.version!==1||!Array.isArray(r.entries)||r.entries.length>10||!Array.isArray(r.history)||r.history.length>500)fail('저장된 기능 목록을 검증하지 못했습니다.');
 const ids=new Set();let total=0;
 for(const e of r.entries){if(!exact(e,['id','versions','activeHash','previousHash'])||!ID.test(e.id)||ids.has(e.id)||!Array.isArray(e.versions)||!e.versions.length)fail('저장된 기능 항목이 올바르지 않습니다.');ids.add(e.id);total+=e.versions.length;const hashes=new Set(),versions=new Set();for(const v of e.versions){if(!exact(v,['hash','manifest','importedAt','verifiedAt','verification'])||!HASH.test(v.hash)||!iso(v.importedAt)||!(v.verifiedAt===null||iso(v.verifiedAt)))fail('기능 버전 기록을 검증하지 못했습니다.');validateManifest(v.manifest);if(v.manifest.id!==e.id||hash(v.manifest)!==v.hash||hashes.has(v.hash)||versions.has(v.manifest.version))fail('기능 원본과 해시가 일치하지 않습니다.');hashes.add(v.hash);versions.add(v.manifest.version);if(v.verification!==null&&(!exact(v.verification,['engine','passed'])||v.verification.engine!=='declarative-v1'||v.verification.passed!==v.manifest.fixtures.length||!v.verifiedAt))fail('기능 시험 기록이 올바르지 않습니다.');}if([e.activeHash,e.previousHash].some(h=>h!==null&&!hashes.has(h)))fail('활성 기능 버전이 없습니다.');if(e.activeHash&&!e.versions.find(v=>v.hash===e.activeHash).verification)fail('시험하지 않은 기능은 활성화할 수 없습니다.');}
 if(total>30)fail('기능 버전은30개까지 보관할 수 있습니다.');
 for(const h of r.history){if(!exact(h,['at','action','id','hash','runId','inputSha256','outputSha256'])||!iso(h.at)||!['import','verify','activate','disable','rollback','run','restore'].includes(h.action)||!(h.id===null||ID.test(h.id))||![h.hash,h.inputSha256,h.outputSha256].every(v=>v===null||HASH.test(v))||!(h.runId===null||text(h.runId,100)))fail('기능 실행 이력이 올바르지 않습니다.');}
 return true;
}
function copy(r){validateCapabilities(r);return structuredClone(r);}
function group(r,id){const e=r.entries.find(e=>e.id===id);if(!e)fail('가져온 기능을 찾을 수 없습니다.',404);return e;}
function version(e,h){const v=e.versions.find(v=>v.hash===(h??e.versions.at(-1).hash));if(!v)fail('기능 버전을 찾을 수 없습니다.',404);return v;}
function history(r,action,id,h,options={},extra={}){r.history.unshift({at:stamp(options),action,id,hash:h,runId:null,inputSha256:null,outputSha256:null,...extra});r.history=r.history.slice(0,500);}
export function importCapability(registry,manifest,options={}){const r=copy(registry);validateManifest(manifest);const h=hash(manifest);let e=r.entries.find(e=>e.id===manifest.id);if(e?.versions.some(v=>v.hash===h))return {registry:r,result:{id:e.id,hash:h,alreadyImported:true}};if(e?.versions.some(v=>v.manifest.version===manifest.version))fail('같은 버전의 원본을 덮어쓸 수 없습니다.',409);if(!e){e={id:manifest.id,versions:[],activeHash:null,previousHash:null};r.entries.push(e);}e.versions.push({hash:h,manifest:structuredClone(manifest),importedAt:stamp(options),verifiedAt:null,verification:null});history(r,'import',e.id,h,options);validateCapabilities(r);return {registry:r,result:{id:e.id,hash:h}};}
export function verifyCapability(registry,id,h,options={}){const r=copy(registry),v=version(group(r,id),h);v.verification=fixtures(v.manifest);v.verifiedAt=stamp(options);history(r,'verify',id,v.hash,options);return {registry:r,result:{id,hash:v.hash,...v.verification}};}
export function activateCapability(registry,id,h,options={}){const r=copy(registry),e=group(r,id),v=version(e,h);if(!v.verification)fail('먼저 기능 시험을 실행하세요.',409);fixtures(v.manifest);if(e.activeHash!==v.hash){e.previousHash=e.activeHash;e.activeHash=v.hash;history(r,'activate',id,v.hash,options);}return {registry:r,result:{id,hash:v.hash,active:true}};}
export function disableCapability(registry,id,options={}){const r=copy(registry),e=group(r,id);if(e.activeHash){e.previousHash=e.activeHash;e.activeHash=null;history(r,'disable',id,e.previousHash,options);}return {registry:r,result:{id,active:false}};}
export function rollbackCapability(registry,id,options={}){const e=group(registry,id);if(!e.previousHash)fail('복원할 이전 버전이 없습니다.',409);const result=activateCapability(registry,id,e.previousHash,options);history(result.registry,'rollback',id,result.result.hash,options);return result;}
export function disableAllCapabilitiesForRestore(registry,options={}){let r=copy(registry);for(const e of r.entries){if(e.activeHash)r=disableCapability(r,e.id,options).registry;}history(r,'restore',null,null,options);return {registry:r,result:{disabled:true}};}
export function createCapabilityRequest(registry,id,input){validateCapabilities(registry);const e=group(registry,id);if(!e.activeHash)fail('먼저 기능을 시험하고 활성화하세요.',409);const v=version(e,e.activeHash);validateInput(v.manifest,input);return {id,hash:v.hash,input:structuredClone(input),inputSha256:capabilityInputSha256(input)};}
export function validateCapabilityRequest(request,registry){if(!exact(request,['id','hash','input','inputSha256'])||!ID.test(request.id)||!HASH.test(request.hash)||!HASH.test(request.inputSha256))fail('저장된 기능 입력이 올바르지 않습니다.');const v=version(group(registry,request.id),request.hash);validateInput(v.manifest,request.input);if(capabilityInputSha256(request.input)!==request.inputSha256)fail('기능 입력의 해시가 다릅니다.');return true;}
export function executeCapability(registry,id,input,options={}){const r=copy(registry),e=group(r,id);if(!e.activeHash||(options.hash&&options.hash!==e.activeHash))fail('기능이 중지되었거나 버전이 바뀌었습니다. 입력과 버전을 확인하세요.',409);const v=version(e,e.activeHash);fixtures(v.manifest);const rows=transform(v.manifest,input);const markdown=render(v.manifest,rows)+`\n---\n기능: ${id} · ${v.manifest.version}\n원본 SHA-256: ${v.hash}\n입력 SHA-256: ${capabilityInputSha256(input)}\n처리: 저장된 입력의 필터·정렬·표 작성. 외부 호출 없음.\n`;const result={id,hash:v.hash,version:v.manifest.version,markdown,rows,inputSha256:capabilityInputSha256(input),outputSha256:hash(markdown),runId:options.runId??crypto.randomUUID()};const old=r.history.find(h=>h.action==='run'&&h.runId===result.runId);if(old&&(old.id!==id||old.hash!==v.hash||old.inputSha256!==result.inputSha256||old.outputSha256!==result.outputSha256))fail('같은 실행 번호의 입력이나 버전이 다릅니다.',409);if(!old)history(r,'run',id,v.hash,options,{runId:result.runId,inputSha256:result.inputSha256,outputSha256:result.outputSha256});return {registry:r,result};}
export function getCapabilityStatus(registry){validateCapabilities(registry);return registry.entries.map(e=>{const v=version(e,e.activeHash??undefined),runs=registry.history.filter(h=>h.action==='run'&&h.id===e.id);return {id:e.id,name:v.manifest.name,description:v.manifest.description,activeHash:e.activeHash,previousHash:e.previousHash,status:e.activeHash?'active':'inactive',source:v.manifest.source,inputSchema:v.manifest.inputSchema,sampleInput:v.manifest.fixtures[0].input,runCount:runs.length,lastRunAt:runs[0]?.at??null,versions:e.versions.map(v=>({hash:v.hash,version:v.manifest.version,verified:!!v.verification,fixtureCount:v.manifest.fixtures.length,importedAt:v.importedAt,verifiedAt:v.verifiedAt}))};});}
