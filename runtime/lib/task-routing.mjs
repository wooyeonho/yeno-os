// A task policy for the configured providers. It does not infer quality from
// model names or authorize a call; the existing budget and owner gates remain.
export const TASK_ROUTES = Object.freeze({
  chat: Object.freeze(['local', 'nvidia', 'gemini', 'openai', 'anthropic']),
  shadowSummary: Object.freeze(['local', 'nvidia', 'gemini', 'openai', 'anthropic']),
  goal: Object.freeze(['nvidia', 'gemini', 'openai', 'anthropic']),
  shadowBuild: Object.freeze(['nvidia', 'gemini', 'openai', 'anthropic']),
  semanticVerify: Object.freeze(['nvidia', 'gemini', 'openai', 'anthropic']),
  research: Object.freeze(['nvidia', 'gemini', 'openai', 'anthropic']),
  code: Object.freeze(['nvidia', 'gemini', 'openai', 'anthropic']),
});
export const ROUTE_RETRY_LIMIT = 0; // A sent request may have completed despite a timeout.
export const ROUTE_TIMEOUT_MS = Object.freeze({remote: 90000, local: 180000});

export function pickProvider(taskClass, profiles, {exclude = []} = {}) {
  const order = TASK_ROUTES[taskClass];
  if (!order) throw new Error(`unknown_task_class:${taskClass}`);
  if (!Array.isArray(profiles)) throw new TypeError('provider profiles must be an array');
  for (const name of order) {
    if (exclude.includes(name)) continue;
    if (profiles.find(entry => entry.provider === name)?.configured === true) return name;
  }
  return null;
}

export function taskClassForJob(job) {
  if (job.voiceConversation) return 'chat';
  if (job.semanticVerifyRequest) return 'semanticVerify';
  if (job.researchRequest) return 'research';
  if (job.codeTask || job.repositoryTask) return 'code';
  if (job.shadowAssignment?.role === 'builder') return 'shadowBuild';
  if (['scout', 'researcher'].includes(job.shadowAssignment?.role)) return 'shadowSummary';
  return 'goal';
}
