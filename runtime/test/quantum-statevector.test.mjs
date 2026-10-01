import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateRestrictedQasm3, sampleStatevector} from '../lib/quantum-statevector.mjs';

const bell = `OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c[0] = measure q[0];
c[1] = measure q[1];
`;

test('MIT quantum-circuit backend produces the Bell state and normalized Born probabilities', () => {
  const result = simulateRestrictedQasm3(bell);
  assert.equal(result.backend, 'quantum-circuit@0.9.251');
  assert.ok(Math.abs(result.probabilities[0] - 0.5) < 1e-12);
  assert.ok(Math.abs(result.probabilities[3] - 0.5) < 1e-12);
  assert.equal(result.probabilities[1], 0);
  assert.equal(result.probabilities[2], 0);
  assert.ok(Math.abs(result.norm - 1) < 1e-12);
});

test('seeded measurement samples only supported Bell outcomes and is replayable', () => {
  const result = simulateRestrictedQasm3(bell);
  const counts = sampleStatevector(result, 128, 91);
  assert.deepEqual(counts, sampleStatevector(result, 128, 91));
  assert.deepEqual(counts.map(item => item.bitstring), ['00', '11']);
  assert.equal(counts.reduce((sum, item) => sum + item.count, 0), 128);
});

test('restricted QASM 3 bridge rejects unsupported gates and inconsistent measurements', () => {
  assert.throws(() => simulateRestrictedQasm3(bell.replace('h q[0];', 'u q[0];')), /unsupported_instruction/);
  assert.throws(() => simulateRestrictedQasm3(bell.replace('c[1] = measure q[1];', 'c[1] = measure q[0];')),
    /invalid_measurement_map/);
  assert.throws(() => simulateRestrictedQasm3(bell.replace('c[1] = measure q[1];', 'h q[1];\nc[1] = measure q[1];')),
    /gate_after_measurement/);
});
