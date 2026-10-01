import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildStatus} from './status-from-log.mjs';

test('status is derived from the latest explicit section marker with separate evidence classes', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-status-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'build-artifacts'));
  fs.writeFileSync(path.join(root,'build-artifacts','proof.json'),'{}');
  const hash=createHash('sha256').update('{}').digest('hex');
  const log=`## §1 — first\n- STATUS|id=G1|stage=P0|implementation=partial|evidence=synthetic|source=1|artifact=build-artifacts/proof.json|sha256=${hash}\n## §2 — next\n- STATUS|id=G1|stage=P0|implementation=implemented|evidence=local,synthetic|source=2|artifact=build-artifacts/proof.json|sha256=${hash}\n- STATUS|id=S9|stage=P3|implementation=not_implemented|evidence=none|source=2|artifact=-|sha256=-\n`;
  const first=buildStatus(log,{root});
  const second=buildStatus(log,{root});
  assert.deepEqual(first,second);
  assert.equal(first.subsystems.length,2);
  assert.equal(first.subsystems[0].implementation,'implemented');
  assert.deepEqual(first.subsystems[0].evidence,['local','synthetic']);
  assert.equal(first.subsystems[0].sourceSection,2);
  assert.equal(first.counts.notImplemented,1);
  assert.equal(first.counts.external,0);
});

test('status refuses invented evidence and an altered or escaping artifact', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-status-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const header='## §7 — proof\n';
  assert.throws(()=>buildStatus(header+'- STATUS|id=XX|stage=P0|implementation=implemented|evidence=external|source=7|artifact=proof.json|sha256='+ '0'.repeat(64),{root}),/artifact_unavailable/);
  assert.throws(()=>buildStatus(header+'- STATUS|id=XX|stage=P0|implementation=implemented|evidence=local|source=7|artifact=..\/secret|sha256='+ '0'.repeat(64),{root}),/artifact_path/);
  assert.throws(()=>buildStatus(header+'- STATUS|id=XX|stage=P0|implementation=not_implemented|evidence=external|source=7|artifact=-|sha256=-',{root}),/evidence_for_unimplemented/);
  fs.writeFileSync(path.join(root,'proof.json'),'{}');
  assert.throws(()=>buildStatus(header+'- STATUS|id=XX|stage=P0|implementation=implemented|evidence=local|source=7|artifact=proof.json|sha256='+ '0'.repeat(64),{root}),/artifact_hash_mismatch/);
});
