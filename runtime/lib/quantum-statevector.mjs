import crypto from 'node:crypto';
import QuantumCircuit from 'quantum-circuit';
import {buildRecoveryOneOfCircuit, decodeRecoveryOneOfCounts} from './recovery-one-of-qpu.mjs';

const ANGLE = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)';
const ROTATION = new RegExp(`^(rx|rz)\\(${ANGLE}\\) q\\[(\\d+)\\];$`);
const fail = message => { throw new Error(`Quantum simulator: ${message}`); };

// Only the frozen recovery compiler's QASM 3 gate subset is accepted. Unknown
// instructions fail closed; this is not a general OpenQASM parser.
export function simulateRestrictedQasm3(qasm) {
  if (typeof qasm !== 'string' || qasm.length > 50000) fail('invalid_qasm');
  const lines = qasm.trim().split(/\r?\n/);
  if (lines[0] !== 'OPENQASM 3.0;' || lines[1] !== 'include "stdgates.inc";') fail('unsupported_header');
  const qubits = /^qubit\[(\d+)\] q;$/.exec(lines[2])?.[1];
  const bits = /^bit\[(\d+)\] c;$/.exec(lines[3])?.[1];
  const count = Number(qubits);
  if (!Number.isInteger(count) || count < 1 || count > 4 || Number(bits) !== count) fail('invalid_registers');
  const circuit = new QuantumCircuit(count);
  const measured = new Set();
  let measuring = false;
  let gateCount = 0;
  for (const line of lines.slice(4)) {
    if (line === 'barrier q;') continue;
    const measurement = /^c\[(\d+)\] = measure q\[(\d+)\];$/.exec(line);
    if (measurement) {
      measuring = true;
      const classical = Number(measurement[1]);
      const qubit = Number(measurement[2]);
      if (classical !== qubit || qubit >= count || measured.has(qubit)) fail('invalid_measurement_map');
      measured.add(qubit);
      continue;
    }
    if (measuring) fail('gate_after_measurement');
    const hadamard = /^h q\[(\d+)\];$/.exec(line);
    const controlled = /^cx q\[(\d+)\], q\[(\d+)\];$/.exec(line);
    const rotation = ROTATION.exec(line);
    if (hadamard) {
      const qubit = Number(hadamard[1]);
      if (qubit >= count) fail('qubit_out_of_range');
      circuit.appendGate('h', qubit);
    } else if (controlled) {
      const control = Number(controlled[1]), target = Number(controlled[2]);
      if (control >= count || target >= count || control === target) fail('qubit_out_of_range');
      circuit.appendGate('cx', [control, target]);
    } else if (rotation) {
      const angle = Number(rotation[2]), qubit = Number(rotation[3]);
      if (!Number.isFinite(angle) || qubit >= count) fail('invalid_rotation');
      circuit.appendGate(rotation[1], qubit, {params: {[rotation[1] === 'rx' ? 'theta' : 'phi']: angle}});
    } else fail('unsupported_instruction');
    gateCount++;
  }
  if (measured.size !== count || gateCount === 0) fail('incomplete_circuit');
  circuit.run();
  const probabilities = Array(2 ** count).fill(0);
  for (const [index, amplitude] of Object.entries(circuit.state)) {
    const position = Number(index);
    if (!Number.isInteger(position) || position < 0 || position >= probabilities.length
        || !Number.isFinite(amplitude.re) || !Number.isFinite(amplitude.im)) fail('invalid_state');
    probabilities[position] = amplitude.re ** 2 + amplitude.im ** 2;
  }
  const norm = probabilities.reduce((sum, value) => sum + value, 0);
  if (Math.abs(norm - 1) > 1e-9) fail('unnormalized_state');
  return {qubits: count, probabilities, norm, gateCount, backend: 'quantum-circuit@0.9.251'};
}

export function simulateRecoveryCircuit(circuit) {
  if (!circuit || circuit.authorizesDispatch !== false || typeof circuit.qasm !== 'string'
      || crypto.createHash('sha256').update(circuit.qasm).digest('hex') !== circuit.qasmSha256) fail('invalid_circuit_reference');
  const result = simulateRestrictedQasm3(circuit.qasm);
  if (result.qubits !== circuit.variableOrder.length) fail('variable_count_mismatch');
  return result;
}

export function sampleStatevector(simulation, shots, seed) {
  if (!simulation || !Number.isInteger(simulation.qubits) || !Array.isArray(simulation.probabilities)
      || simulation.probabilities.length !== 2 ** simulation.qubits
      || simulation.probabilities.some(value => !Number.isFinite(value) || value < 0)
      || Math.abs(simulation.probabilities.reduce((sum, value) => sum + value, 0) - 1) > 1e-9
      || !Number.isSafeInteger(shots) || shots < 1 || shots > 8192
      || !Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) fail('invalid_sampling_request');
  let randomState = seed >>> 0;
  const counts = new Map();
  for (let shot = 0; shot < shots; shot++) {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    const draw = (randomState >>> 0) / 0x100000000;
    let cumulative = 0;
    let selected = simulation.probabilities.length - 1;
    for (let index = 0; index < simulation.probabilities.length; index++) {
      cumulative += simulation.probabilities[index];
      if (draw < cumulative) { selected = index; break; }
    }
    const bitstring = selected.toString(2).padStart(simulation.qubits, '0');
    counts.set(bitstring, (counts.get(bitstring) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right))
    .map(([bitstring, count]) => ({bitstring, count}));
}

export function optimizeRecoveryOneOf(context, {gridSize = 8, shots = 1024, seed = 1} = {}) {
  if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > 16) fail('invalid_grid');
  const sweep = [];
  let best = null;
  for (let gi = 0; gi < gridSize; gi++) for (let bi = 0; bi < gridSize; bi++) {
    const gamma = 2 * Math.PI * gi / gridSize;
    const beta = Math.PI * bi / gridSize;
    const circuit = buildRecoveryOneOfCircuit({...context, parameters: {gamma, beta, shots}});
    const simulation = simulateRecoveryCircuit(circuit);
    const feasibleProbability = simulation.probabilities.reduce((sum, probability, index) =>
      sum + ((index.toString(2).match(/1/g)?.length ?? 0) === 1 ? probability : 0), 0);
    const point = {gamma, beta, feasibleProbability, circuitSha256: circuit.qasmSha256};
    sweep.push(point);
    if (!best || point.feasibleProbability > best.feasibleProbability) best = {...point, circuit, simulation};
  }
  const counts = sampleStatevector(best.simulation, shots, seed);
  const selection = decodeRecoveryOneOfCounts({circuit: best.circuit, counts, bitOrder: 'c0-rightmost'},
    {...context, parameters: {gamma: best.gamma, beta: best.beta, shots}});
  return {sweep, best: {gamma: best.gamma, beta: best.beta, feasibleProbability: best.feasibleProbability,
    uniformBaseline: best.circuit.variableOrder.length / 2 ** best.circuit.variableOrder.length,
    circuitSha256: best.circuit.qasmSha256}, counts, selection, authorizesDispatch: false};
}
