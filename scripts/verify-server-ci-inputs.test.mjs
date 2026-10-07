import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyServerCiInputs} from './verify-server-ci-inputs.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dockerignore=fs.readFileSync(path.join(root,'.dockerignore'),'utf8');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/server-only-verify.yml'),'utf8');
const packageText=fs.readFileSync(path.join(root,'package.json'),'utf8');
const dockerfile=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');

test('every Docker COPY source exists and is admitted by the build context',()=>{
  assert.deepEqual(verifyServerCiInputs(root),[]);
});

test('regression gate detects an excluded locked dependency',()=>{
  const broken=dockerignore.replace(/!runtime\/package-lock\.json\r?\n/,'');
  assert.ok(verifyServerCiInputs(root,{dockerignoreText:broken,workflowText:workflow})
    .includes('dockerignore_excludes:Dockerfile:runtime/package-lock.json:!runtime/package-lock.json'));
});

test('server-only CI rejects missing inputs and mutable supply-chain references',()=>{
  const broken=packageText.replaceAll('runtime/test/repository-phone-order-api.test.mjs','runtime/test/missing-phone.test.mjs');
  assert.ok(verifyServerCiInputs(root,{dockerignoreText:dockerignore,workflowText:workflow,packageText:broken})
    .includes('ci_command_missing:runtime/test/repository-phone-order-api.test.mjs'));
  const mutableAction=workflow.replace('actions/checkout@11d5960a326750d5838078e36cf38b85af677262','actions/checkout@v4');
  assert.ok(verifyServerCiInputs(root,{dockerignoreText:dockerignore,workflowText:mutableAction})
    .includes('ci_action_not_sha:actions/checkout@v4'));
  const floatingNode=workflow.replace("node-version: '24.19.0'","node-version: '24'");
  assert.ok(verifyServerCiInputs(root,{dockerignoreText:dockerignore,workflowText:floatingNode})
    .includes('ci_node_version_unpinned'));
  const broadTrigger=workflow.replace('a3-server-ci-pilot','main');
  assert.ok(verifyServerCiInputs(root,{dockerignoreText:dockerignore,workflowText:broadTrigger})
    .includes('ci_trigger_not_exact_pilot_push'));
  const mutableBase=dockerfile.replace('@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20','');
  assert.ok(verifyServerCiInputs(root,{dockerignoreText:dockerignore,workflowText:workflow,dockerfileTexts:{Dockerfile:mutableBase}})
    .includes('docker_base_unpinned:Dockerfile'));
});
