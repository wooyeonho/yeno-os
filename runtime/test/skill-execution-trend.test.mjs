import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSkillHistory} from '../lib/solo-leveling.mjs';
import {executionTrend} from '../lib/skill-execution-trend.mjs';
import {sha256} from '../lib/outcome-verification.mjs';

const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const at = n => `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`;
const hash = value => sha256(value);

function history(verified, terminal = verified.length) {
  const runs = [], executions = [];
  for (let n = 1; n <= terminal; n++) {
    const success = verified[n - 1] === true;
    if (success) runs.push({at: at(n), action: 'run', id: 'digest', hash: hash('version'), runId: id(n), inputSha256: hash(`input-${n}`), outputSha256: hash(`output-${n}`)});
    executions.push({jobId: id(n), skillId: 'digest', status: success ? 'completed' : 'failed', executionVerified: success, authorizedBy: 'owner', at: at(n)});
  }
  const registry = {entries: [{id: 'digest', activeHash: hash('version')}], history: runs};
  return buildSkillHistory(null, {registry, skillId: 'digest', executions: executions.reverse()});
}

test('decline is reported from verified terminal jobs, regardless of input order, without changing grade', () => {
  const evidence = history([true,true,true,true,true,true,false,false,false,false]);
  const originalGrade = evidence.grade;
  const trend = executionTrend(evidence);
  assert.equal(trend.status, 'declining');
  assert.deepEqual(trend.previous, {verified: 5, total: 5});
  assert.deepEqual(trend.latest, {verified: 1, total: 5});
  assert.equal(evidence.grade, originalGrade);
});

test('fewer than ten terminal jobs cannot establish a trend', () => {
  const trend = executionTrend(history([true,true,true,true,true,false,false,false,false]));
  assert.equal(trend.status, 'insufficient_evidence');
  assert.equal(trend.observed, 9);
  assert.equal(trend.previous, null);
  assert.equal(trend.latest, null);
});

test('ten verified successes are stable, while one missing verified success only enters watch', () => {
  assert.equal(executionTrend(history(Array(10).fill(true))).status, 'stable');
  assert.equal(executionTrend(history([true,true,true,true,true,true,true,true,true,false])).status, 'watch');
});
