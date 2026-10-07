import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SOURCE_AUDIT_TYPE="source-audit";
export const SOURCE_AUDIT_ARTIFACTS=Object.freeze(["yeno-production-gap-report.json","yeno-production-gap-report.md","yeno-production-next-task-checklist.md"]);
export const SOURCE_AUDIT_BUNDLE_MANIFEST_SHA256="e6d455d4024e12b85e1649e681a87c0cca53e1ad57ff74afdf98b318cb314235";
const COMMIT="1fed279c7ebaee18e29c4a72589c3c13d94c9625",TREE="19db510d857c9719f365de147d552824a2a13e8d",HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EXPECTED_FILES=Object.freeze({
  "Dockerfile.koyeb":{gitBlob:"38ba1ae0cf5839f865c60e193e1bad32bffc6a1b",sha256:"42070cc93d4cbd7f45f318aadd746e94857a8d0c4b9a8969ea6c7cdf758d920c",bytes:1975},
  "apps/controller/src/command-session.ts":{gitBlob:"e6c115d70cd18e4294d9adef736521d630d5103e",sha256:"d05bb064317f513627dd337ce8cf179fed7b7176090ed306bc1cbed10c8c64ba",bytes:4327},
  "apps/controller/src/main.ts":{gitBlob:"e59a2d107dea287f901bb8d753e52499bc053d2d",sha256:"64c151f45f51405f1f347a80dd099676eeb1dccad30e68efd1ea90aa25e16d65",bytes:23441},
  "apps/controller/src/native-studio.ts":{gitBlob:"e049fca864d67c62af8f83eb69baa403c47fd5d5",sha256:"176f1e2287933b1be52de6844d45d138d6317a45d8a2030af027a7aa6f0f4b96",bytes:7590},
  "runtime/server.mjs":{gitBlob:"8daaf9d0c9154e9f4f327f5c7d726f718ac11779",sha256:"1444ca4a6a74d0da30a1cf200b05fe028df47362cbcb3901e03167df3cb6c232",bytes:115018},
  "scripts/start-koyeb.sh":{gitBlob:"2f488f75045669c2018a267bd980376ac54fed4b",sha256:"47bf25232cd447130b7fafd138d44945ded37a6c89600ca40e4000025907c403",bytes:768},
  "docs/FIRST_TASK.md":{gitBlob:"e2d55fc0f655b0d0b0000b42e8d0d435329e9d21",sha256:"c668f9732a356bab81b34fdda082fa528d2686e453a9bcc2d351465b33e5a0de",bytes:3087}
});
const sha256=(value)=>crypto.createHash("sha256").update(value).digest("hex");
const fail=(message)=>{throw new Error(`Source audit: ${message}`);};
const record=(value)=>value!==null&&typeof value==="object"&&!Array.isArray(value);

export function loadSourceAuditBundle(file){
  const bundle=JSON.parse(fs.readFileSync(file,"utf8"));
  if(!record(bundle)||bundle.version!==1||bundle.commit!==COMMIT||bundle.tree!==TREE||bundle.source!=="exact deployed Git blobs"||bundle.manifestSha256!==SOURCE_AUDIT_BUNDLE_MANIFEST_SHA256||!Array.isArray(bundle.files)||bundle.files.length!==7)fail("invalid immutable bundle header");
  const paths=new Set(),publicFiles=[];let totalBytes=0;
  for(const entry of bundle.files){
    const expected=EXPECTED_FILES[entry.relativePath];if(!record(entry)||!expected||paths.has(entry.relativePath)||entry.gitBlob!==expected.gitBlob||entry.bytes!==expected.bytes||entry.sha256!==expected.sha256||!Number.isSafeInteger(entry.lineCount)||entry.lineCount<1||typeof entry.base64!=="string")fail("invalid bundled file");
    const bytes=Buffer.from(entry.base64,"base64");if(bytes.toString("base64")!==entry.base64||bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)fail("bundled file hash mismatch");
    paths.add(entry.relativePath);totalBytes+=bytes.length;publicFiles.push({relativePath:entry.relativePath,gitBlob:entry.gitBlob,bytes:entry.bytes,sha256:entry.sha256,lineCount:entry.lineCount});
  }
  const metadata={version:bundle.version,commit:bundle.commit,tree:bundle.tree,source:bundle.source,files:publicFiles,excluded:bundle.excluded};
  if(sha256(JSON.stringify(metadata))!==bundle.manifestSha256||totalBytes>200000)fail("bundle manifest mismatch");
  return Object.freeze({...bundle,totalBytes});
}

export function parseSourceAuditCommand(text){
  if(typeof text!=="string"||text.length>2000)return null;const match=text.match(/^BLACKHOLE AUDIT(?:\s*\|\s*(.+))?$/is);if(!match)return null;
  const goal=(match[1]??"Report implementation gaps in the exact deployed phone-to-artifact path.").trim();if(!goal||goal.length>500)fail("goal must be 1-500 characters");return {goal};
}

const snapshot=(bundle,path)=>{const item=bundle.files.find(entry=>entry.relativePath===path);if(!item)fail(`missing bundled path ${path}`);return {...item,text:Buffer.from(item.base64,"base64").toString("utf8").replace(/\r\n?/g,"\n")};};
const evidence=(bundle,path,pattern)=>{const file=snapshot(bundle,path),lines=file.text.split("\n");for(let index=0;index<lines.length;index++)if(pattern.test(lines[index]))return{path,line:index+1,snippet:lines[index].trim().slice(0,260),sourceSha256:file.sha256};return null;};

export function runSourceAudit(bundle,goal){
  const findings=[];const add=(id,status,title,path,pattern,assessment)=>findings.push({id,status,title,assessment,evidence:evidence(bundle,path,pattern)});
  add("PROD-001","verified","Phone persists command identity before delivery","apps/controller/src/command-session.ts",/setItem\(this\.pendingKey/,"The deployed controller persists the pending command before transport and retains it across uncertain outcomes.");
  add("PROD-002","verified","Phone verifies artifact response hashes","apps/controller/src/native-studio.ts",/sha256\(bytes\) !== expected/,"The deployed readVerifiedFile implementation compares downloaded bytes with X-Content-SHA256; this cites the implementation, not only its caller.");
  add("PROD-003","verified","Runtime holds unfinished jobs after restart","runtime/server.mjs",/pauseReason='restart'/,"The deployed runtime pauses queued/running jobs after restart and requires owner resume.");
  add("PROD-004","verified","Runtime blocks corrupted artifact downloads","runtime/server.mjs",/Artifact checksum mismatch; download blocked/,"The deployed artifact route recomputes SHA-256 before returning bytes.");
  add("PROD-005","verified","Koyeb image declares an active health check","Dockerfile.koyeb",/^HEALTHCHECK /,"The deployed Dockerfile contains a HEALTHCHECK that calls the versioned health endpoint. EXPOSE alone is not used as health evidence.");
  const existing=evidence(bundle,"runtime/server.mjs",/source-audit/);
  findings.push({id:"PROD-006",status:existing?"observed":"gap",title:"Deployed runtime audit capability",assessment:existing?"A source-audit marker exists in the exact deployed snapshot.":"No source-audit marker exists in the exact deployed runtime snapshot; r4 is a local patch candidate only.",evidence:existing});
  if(findings.some(item=>item.id!=="PROD-006"&&!item.evidence))fail("required production evidence not found");
  const body={version:1,taskType:"production-source-audit",analysisKind:"local-deterministic-source-audit",goal,production:{commit:bundle.commit,tree:bundle.tree,deployedBundleManifestSha256:bundle.manifestSha256},sourceFiles:bundle.files.map(({base64:_b,...file})=>file),excluded:bundle.excluded,coverage:{files:bundle.files.length,bytes:bundle.totalBytes,rules:findings.length,citedFindings:findings.filter(x=>x.evidence).length},findings,limitations:["Report-only deterministic inspection; not AI.","The immutable bundle contains exact deployed Git blobs embedded into the Docker image candidate; it does not read a live checkout.","No deployment, Android device action, provider call, credential read, or external request is performed.","Completion proves only this bounded report and its three verified artifacts."],modelCalls:0,externalRequests:0,sourceFilesModified:0};
  const report={...body,fingerprint:sha256(JSON.stringify(body))};
  const rows=findings.map(item=>`- **${item.id} — ${item.status}: ${item.title}.** ${item.assessment}${item.evidence?` Evidence: \`${item.evidence.path}:${item.evidence.line}\` — \`${item.evidence.snippet.replace(/`/g,"'")}\``:" Evidence: not present in the bounded production bundle."}`).join("\n");
  const markdown=`# Production implementation-gap report\n\n- Analysis: local deterministic source audit (not AI)\n- Deployed commit: \`${bundle.commit}\`\n- Deployed tree: \`${bundle.tree}\`\n- Bundle manifest: \`${bundle.manifestSha256}\`\n- Model calls: 0\n- External requests: 0\n- Coverage: ${bundle.files.length} files, ${bundle.totalBytes} bytes\n\n## Findings\n\n${rows}\n\n## Limitations\n\n${report.limitations.map(x=>`- ${x}`).join("\n")}\n\nReport fingerprint: \`${report.fingerprint}\`\n`;
  const checklist=`# Production audit next-task checklist\n\nBound to deployed commit \`${bundle.commit}\` and report \`${report.fingerprint}\`.\n\n- [ ] Review this local production-based patch candidate.\n- [ ] Build an image that explicitly copies \`runtime/source-audit-bundle.json\`.\n- [ ] Run authenticated Android command → reopen → artifact download acceptance against a separately approved deployment.\n- [ ] Confirm cancelled audit jobs produce no artifacts.\n- [ ] Confirm restarted unfinished audits remain paused until owner resume.\n- [ ] Do not call a model or claim broader source coverage for this report-only capability.\n`;
  return{report,outputs:{"yeno-production-gap-report.json":`${JSON.stringify(report,null,2)}\n`,"yeno-production-gap-report.md":markdown,"yeno-production-next-task-checklist.md":checklist}};
}

export function createSourceAuditState(bundle,goal){return{version:1,mode:"report-only",analysisKind:"local-deterministic-source-audit",deployedCommit:bundle.commit,deployedTree:bundle.tree,bundleManifestSha256:bundle.manifestSha256,goal,modelCalls:0,externalRequests:0,evidenceState:"pending",reportFingerprint:null,artifactReceipt:[]};}

export function sourceAuditArtifactId(jobId,name){
  const hex=crypto.createHash("sha256").update(`source-audit\0${jobId}\0${name}`).digest("hex").slice(0,32).split("");hex[12]="4";hex[16]=["8","9","a","b"][Number.parseInt(hex[16],16)%4];return`${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}

let validationBundle;
const immutableValidationBundle=()=>validationBundle??=loadSourceAuditBundle(new URL("../source-audit-bundle.json",import.meta.url));

function validateCapturedOutput(output,audit,job){
  if(!record(output)||Object.keys(output).sort().join(",")!==[...SOURCE_AUDIT_ARTIFACTS].sort().join(",")||Object.values(output).some(value=>typeof value!=="string"||!value)||Buffer.byteLength(JSON.stringify(output))>256000)fail("invalid pending source-audit output");
  let report;try{report=JSON.parse(output["yeno-production-gap-report.json"]);}catch{fail("invalid captured audit JSON");}
  const {fingerprint,...body}=record(report)?report:{};
  if(fingerprint!==sha256(JSON.stringify(body))||fingerprint!==audit.reportFingerprint)fail("captured audit report fingerprint mismatch");
  const expected=runSourceAudit(immutableValidationBundle(),job.input);
  if(expected.report.fingerprint!==audit.reportFingerprint||SOURCE_AUDIT_ARTIFACTS.some(name=>output[name]!==expected.outputs[name]))fail("captured audit output is not deterministically bound");
}

export function validateSourceAuditJob(job){
  if(job.type!==SOURCE_AUDIT_TYPE){if(Object.hasOwn(job,"sourceAudit")||Object.hasOwn(job,"sourceAuditOutput"))fail("audit fields on non-audit job");return true;}
  const audit=job.sourceAudit,allowed=["version","mode","analysisKind","deployedCommit","deployedTree","bundleManifestSha256","goal","modelCalls","externalRequests","evidenceState","reportFingerprint","artifactReceipt","evidenceFailure","quarantinedAt"];
  if(!record(audit)||Object.keys(audit).some(key=>!allowed.includes(key))||audit.version!==1||audit.mode!=="report-only"||audit.analysisKind!=="local-deterministic-source-audit"||audit.deployedCommit!==COMMIT||audit.deployedTree!==TREE||audit.bundleManifestSha256!==SOURCE_AUDIT_BUNDLE_MANIFEST_SHA256||typeof audit.goal!=="string"||!audit.goal||audit.goal.length>500||audit.goal!==job.input||audit.modelCalls!==0||audit.externalRequests!==0||!["pending","verified","quarantined"].includes(audit.evidenceState)||!(audit.reportFingerprint===null||HASH.test(audit.reportFingerprint))||!Array.isArray(audit.artifactReceipt)||audit.artifactReceipt.length>3)fail("invalid source-audit job");
  const names=new Set(),ids=new Set();for(const item of audit.artifactReceipt){if(!record(item)||!UUID.test(item.id??"")||!SOURCE_AUDIT_ARTIFACTS.includes(item.name)||names.has(item.name)||ids.has(item.id)||!HASH.test(item.sha256??"")||!Number.isSafeInteger(item.bytes)||item.bytes<1)fail("invalid source-audit receipt");names.add(item.name);ids.add(item.id);}
  const hasOutput=Object.hasOwn(job,"sourceAuditOutput");if(hasOutput)validateCapturedOutput(job.sourceAuditOutput,audit,job);
  if(job.status==="completed"&&(job.step!==3||hasOutput||audit.evidenceState!=="verified"||audit.artifactReceipt.length!==3||names.size!==3||!SOURCE_AUDIT_ARTIFACTS.every(name=>names.has(name))||!HASH.test(audit.reportFingerprint??"")))fail("completed source-audit lacks verified receipt");
  if(audit.evidenceState==="quarantined"&&(job.status!=="failed"||job.step!==3||hasOutput||audit.artifactReceipt.length!==3||typeof audit.evidenceFailure!=="string"||!audit.evidenceFailure||typeof audit.quarantinedAt!=="string"||!Number.isFinite(Date.parse(audit.quarantinedAt))))fail("invalid quarantined source-audit");
  if(["queued","running","paused"].includes(job.status)){if(job.step===2){if(!hasOutput||!HASH.test(audit.reportFingerprint??"")||audit.artifactReceipt.length!==0)fail("invalid captured source-audit checkpoint");}else if(hasOutput||audit.reportFingerprint!==null||audit.artifactReceipt.length!==0)fail("audit evidence exists before generation");}
  if(job.status==="cancelled"&&(hasOutput||audit.artifactReceipt.length!==0||audit.evidenceState!=="pending"))fail("cancelled audit retained output");return true;
}

export function verifySourceAuditArtifacts(job,registry,artifactDirectory){
  if(job.type!==SOURCE_AUDIT_TYPE||job.status!=="completed")return{valid:true};try{validateSourceAuditJob(job);if(job.sourceAudit.artifactReceipt.length!==3||job.artifacts.length!==3)return{valid:false,reason:"artifact-count"};
    for(const expected of job.sourceAudit.artifactReceipt){if(!SOURCE_AUDIT_ARTIFACTS.includes(expected.name)||!HASH.test(expected.sha256??""))return{valid:false,reason:"receipt"};const item=registry[expected.id];if(!item||item.jobId!==job.id||item.name!==expected.name||item.sha256!==expected.sha256||item.bytes!==expected.bytes||!job.artifacts.some(ref=>ref.id===item.id&&ref.name===item.name))return{valid:false,reason:"registry"};const file=path.join(artifactDirectory,item.filename);if(path.dirname(file)!==artifactDirectory)return{valid:false,reason:"path"};const bytes=fs.readFileSync(file);if(bytes.length!==item.bytes||sha256(bytes)!==item.sha256)return{valid:false,reason:"bytes"};}
    return{valid:true};}catch{return{valid:false,reason:"unreadable"};}
}
