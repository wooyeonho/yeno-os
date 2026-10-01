import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const EVIDENCE=new Set(['local','synthetic','external','none']);
const IMPLEMENTATION=new Set(['implemented','partial','not_implemented']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function parseMarker(line,{root,sections}){
  const pieces=line.split('|');
  if(pieces.shift()!=='STATUS')throw new Error('status_marker');
  const fields={};
  for(const piece of pieces){const at=piece.indexOf('=');if(at<=0)throw new Error('status_field');const key=piece.slice(0,at);if(Object.hasOwn(fields,key))throw new Error('duplicate_status_field');fields[key]=piece.slice(at+1);}
  if(Object.keys(fields).sort().join(',')!=='artifact,evidence,id,implementation,sha256,source,stage')throw new Error('status_fields');
  if(!/^[A-Za-z][A-Za-z0-9-]{1,40}$/.test(fields.id))throw new Error('status_id');
  if(!/^P[0-6]$/.test(fields.stage))throw new Error('status_stage');
  if(!IMPLEMENTATION.has(fields.implementation))throw new Error('status_implementation');
  const evidence=fields.evidence.split(',');
  if(!evidence.length||new Set(evidence).size!==evidence.length||evidence.some(item=>!EVIDENCE.has(item))||(evidence.includes('none')&&evidence.length!==1))throw new Error('status_evidence');
  const sourceSection=Number(fields.source);
  if(!Number.isSafeInteger(sourceSection)||!sections.has(sourceSection))throw new Error('status_source_section');
  if(fields.implementation==='not_implemented'&&fields.evidence!=='none')throw new Error('evidence_for_unimplemented');
  if(fields.implementation==='implemented'&&fields.evidence==='none')throw new Error('implemented_without_evidence');
  const noArtifact=fields.artifact==='-'&&fields.sha256==='-';
  if(!noArtifact){
    if(fields.artifact==='-'||!/^[a-f0-9]{64}$/.test(fields.sha256))throw new Error('status_artifact_hash');
    const artifact=fields.artifact.replaceAll('\\','/');
    if(artifact.startsWith('/')||artifact.split('/').some(part=>part==='..'||part==='.'||!part)||/^[A-Za-z]:/.test(artifact))throw new Error('artifact_path');
    const absolute=path.resolve(root,artifact);
    if(!absolute.startsWith(path.resolve(root)+path.sep))throw new Error('artifact_path');
    if(!fs.existsSync(absolute)||!fs.statSync(absolute).isFile())throw new Error('artifact_unavailable');
    if(!fs.realpathSync(absolute).startsWith(fs.realpathSync(root)+path.sep))throw new Error('artifact_path');
    if(sha(fs.readFileSync(absolute))!==fields.sha256)throw new Error('artifact_hash_mismatch');
  }else if(fields.implementation==='implemented')throw new Error('implemented_without_artifact');
  return {id:fields.id,stage:fields.stage,implementation:fields.implementation,evidence,sourceSection,artifact:noArtifact?null:fields.artifact,sha256:noArtifact?null:fields.sha256};
}

export function buildStatus(log,{root=ROOT}={}){
  const lines=log.split(/\r?\n/);
  const sections=new Set(lines.map(line=>/^## §(\d+)/.exec(line)?.[1]).filter(Boolean).map(Number));
  const markerLines=lines.map(line=>line.trim().replace(/^- /,'')).filter(line=>line.startsWith('STATUS|'));
  if(!markerLines.length)throw new Error('status_markers_missing');
  const latest=new Map();
  for(const marker of markerLines){const row=parseMarker(marker,{root,sections});latest.set(row.id,row);}
  const subsystems=[...latest.values()].sort((a,b)=>a.stage.localeCompare(b.stage)||a.id.localeCompare(b.id));
  const counts={implemented:0,partial:0,notImplemented:0,local:0,synthetic:0,external:0,none:0};
  for(const row of subsystems){counts[row.implementation==='not_implemented'?'notImplemented':row.implementation]++;for(const type of row.evidence)counts[type]++;}
  return {schemaVersion:1,source:'docs/CLAUDE_EXECUTION_STATE.md',sourceMarkerSha256:sha(markerLines.join('\n')),counts,subsystems};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??'--print';
  if(!['--print','--write','--check'].includes(mode)||process.argv.length>3){console.error('Usage: node scripts/status-from-log.mjs [--print|--write|--check]');process.exit(2);}
  try{
    const source=fs.readFileSync(path.join(ROOT,'docs','CLAUDE_EXECUTION_STATE.md'),'utf8');
    const json=JSON.stringify(buildStatus(source),null,2)+'\n';
    const output=path.join(ROOT,'docs','STATUS.json');
    if(mode==='--write')fs.writeFileSync(output,json,'utf8');
    else if(mode==='--check'){
      if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==json)throw new Error('status_out_of_date');
    }else process.stdout.write(json);
    if(mode!=='--print')console.log(`STATUS ${mode.slice(2)}: ${sha(json)}`);
  }catch(error){console.error(`STATUS generation failed: ${error.message}`);process.exitCode=1;}
}
