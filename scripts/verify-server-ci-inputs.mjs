import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const COPY_FILES=['Dockerfile','Dockerfile.koyeb'];
const NODE_IMAGE='node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20';
const APPROVED_ACTIONS=new Set([
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
]);
const REQUIRED_TESTS=[
  'scripts/verify-server-ci-inputs.test.mjs',
  'runtime/test/repository-plan-api.test.mjs',
  'runtime/test/repository-developer-consumer-api.test.mjs',
  'runtime/test/repository-developer-consumer.test.mjs',
  'runtime/test/repository-bounded-order-executor.test.mjs',
  'runtime/test/repository-phone-order-api.test.mjs',
];

const clean=value=>value.replaceAll('\\','/').replace(/^\.\//,'');
export function copySources(text){
  const sources=[];
  for(const line of text.split(/\r?\n/)){
    const trimmed=line.trim();
    if(!trimmed.startsWith('COPY '))continue;
    const fields=trimmed.slice(5).trim().split(/\s+/);
    if(fields.length<2||fields.some(field=>field.startsWith('--')))throw new Error('unsupported_copy_syntax');
    sources.push(...fields.slice(0,-1).map(clean));
  }
  return sources;
}

export function verifyServerCiInputs(root,{dockerignoreText,workflowText,packageText,dockerfileTexts={}}={}){
  const errors=[];
  const ignore=dockerignoreText??fs.readFileSync(path.join(root,'.dockerignore'),'utf8');
  const rules=new Set(ignore.split(/\r?\n/).map(line=>line.trim()).filter(Boolean));
  for(const dockerfile of COPY_FILES){
    const file=path.join(root,dockerfile);
    if(!fs.existsSync(file)){errors.push(`missing:${dockerfile}`);continue;}
    const dockerfileText=dockerfileTexts[dockerfile]??fs.readFileSync(file,'utf8');
    if(!dockerfileText.split(/\r?\n/).some(line=>line.trim()===`FROM ${NODE_IMAGE}`))errors.push(`docker_base_unpinned:${dockerfile}`);
    for(const source of copySources(dockerfileText)){
      const diskPath=path.join(root,source);
      if(!fs.existsSync(diskPath)){errors.push(`copy_source_missing:${dockerfile}:${source}`);continue;}
      const directory=source.endsWith('/')||fs.statSync(diskPath).isDirectory();
      const required=`!${source.replace(/\/$/,'')}${directory?'/**':''}`;
      if(!rules.has(required))errors.push(`dockerignore_excludes:${dockerfile}:${source}:${required}`);
    }
  }
  const workflow=workflowText??fs.readFileSync(path.join(root,'.github/workflows/server-only-verify.yml'),'utf8');
  const normalizedWorkflow=workflow.replaceAll('\r\n','\n');
  if(!normalizedWorkflow.includes("on:\n  push:\n    branches:\n      - a3-server-ci-pilot\n"))errors.push('ci_trigger_not_exact_pilot_push');
  if(/\bworkflow_dispatch\s*:/.test(normalizedWorkflow))errors.push('ci_trigger_manual_dispatch_forbidden');
  const actions=[...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map(match=>match[1]).filter(value=>!value.startsWith('./'));
  for(const action of actions){
    if(!/@[a-f0-9]{40}$/.test(action))errors.push(`ci_action_not_sha:${action}`);
    else if(!APPROVED_ACTIONS.has(action))errors.push(`ci_action_unapproved:${action}`);
  }
  for(const approved of APPROVED_ACTIONS)if(!actions.includes(approved))errors.push(`ci_action_missing:${approved.split('@')[0]}`);
  if(!/^\s*node-version:\s*['"]24\.19\.0['"]\s*$/m.test(workflow))errors.push('ci_node_version_unpinned');
  const manifest=JSON.parse(packageText??fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const serverCommand=manifest.scripts?.['test:server-only']??'';
  for(const required of REQUIRED_TESTS){
    if(!fs.existsSync(path.join(root,required)))errors.push(`ci_input_missing:${required}`);
    if(!serverCommand.includes(required))errors.push(`ci_command_missing:${required}`);
  }
  for(const forbidden of ['apps/controller','android-debug','npm test\n']){
    if(workflow.toLowerCase().includes(forbidden))errors.push(`server_ci_scope_violation:${forbidden}`);
  }
  if(!workflow.includes('npm run test:server-only'))errors.push('ci_command_missing:test:server-only');
  if(!workflow.includes('docker build --file Dockerfile.koyeb'))errors.push('ci_command_missing:docker_build');
  if(!workflow.includes('--network none'))errors.push('ci_command_missing:network_none');
  return errors;
}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const errors=verifyServerCiInputs(root);
  process.stdout.write(`${JSON.stringify({schema:1,root,errors,result:errors.length?'FAIL':'PASS'},null,2)}\n`);
  if(errors.length)process.exitCode=1;
}
