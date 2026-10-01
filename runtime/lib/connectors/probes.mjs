import {searchObsidianRest} from '../obsidian-rest-search.mjs';

class ProbeError extends Error { constructor() { super('Connector function check failed.'); } }
const bell = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc[0] = measure q[0];\nc[1] = measure q[1];\n';

async function responseJson(response) {
  if (!response.ok || !response.body) throw new ProbeError();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new ProbeError(); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export async function probeConnector(id, config, transport) {
  const {fetchImpl, signal, synthetic, ollamaProbe} = transport;
  const evidenceClass = synthetic ? 'synthetic' : 'live';
  switch (id) {
    case 'quantum-circuit': {
      const {simulateRestrictedQasm3, sampleStatevector} = await import('../quantum-statevector.mjs');
      signal.throwIfAborted();
      const result = simulateRestrictedQasm3(bell);
      const expected = [0.5, 0, 0, 0.5];
      if (result.qubits !== 2 || result.probabilities.some((value, index) => Math.abs(value - expected[index]) > 1e-9)) throw new ProbeError();
      const samples = sampleStatevector(result, 64, 91);
      if (samples.some(item => !['00', '11'].includes(item.bitstring)) || samples.reduce((sum, item) => sum + item.count, 0) !== 64) throw new ProbeError();
      return {class: 'live', operation: 'bell_self_check', backend: 'quantum-circuit@0.9.251',
        countsOrigin: 'local_statevector_simulator', qubits: 2, shots: 64, bellVerified: true};
    }
    case 'ollama': {
      if (ollamaProbe) {
        const result = await ollamaProbe({signal});
        if (result?.nonEmpty !== true || !Number.isSafeInteger(result.replyLength)
            || result.replyLength < 1 || result.replyLength > 1024
            || (result.jobId !== undefined && (typeof result.jobId !== 'string'
              || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.jobId)))) throw new ProbeError();
        return {class: evidenceClass, operation: 'bounded_chat_completion', backend: 'local_openai_compatible',
          generationCalls: 1, responseValidated: true, ...(result.maxOutputTokens === 8 ? {maxOutputTokens: 8} : {}),
          ...(result.jobId ? {jobId: result.jobId} : {})};
      }
      const response = await fetchImpl(config.endpoint, {method: 'POST', redirect: 'error', signal,
        headers: {'content-type': 'application/json'}, body: JSON.stringify({model: config.model,
          messages: [{role: 'user', content: 'Reply OK.'}], stream: false, max_tokens: 8, temperature: 0})});
      const payload = await responseJson(response);
      const choice = payload?.choices?.[0];
      if (!Array.isArray(payload?.choices) || payload.choices.length !== 1 || choice?.message?.role !== 'assistant'
          || typeof choice.message.content !== 'string' || !choice.message.content.trim()
          || choice.message.content.length > 1024 || !['stop', 'length'].includes(choice.finish_reason)) throw new ProbeError();
      return {class: evidenceClass, operation: 'bounded_chat_completion', backend: 'local_openai_compatible',
        generationCalls: 1, maxOutputTokens: 8, responseValidated: true};
    }
    case 'obsidian': {
      const boundedFetch = (url, options) => fetchImpl(url, {...options, signal: AbortSignal.any([signal, options.signal])});
      await searchObsidianRest({...config, query: 'BLACKHOLE'}, {fetchImpl: boundedFetch});
      return {class: evidenceClass, operation: 'draft_search', backend: 'obsidian_local_rest_api',
        readOnly: true, scope: '01_DRAFTS', responseValidated: true};
    }
    default: throw new ProbeError();
  }
}
