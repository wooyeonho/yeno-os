const LOCAL_JOB_TYPES = Object.freeze([
  'document', 'diagnostics', 'evolution', 'world', 'video', 'forai', 'capability', 'verify',
]);
const MODEL_JOB_TYPES = Object.freeze(['agent', 'ai']);
const DEVELOPMENT_CODE_MODES = Object.freeze(['generate', 'repair']);
const LOCAL_CODE_MODES = Object.freeze(['github', 'import', 'verify', 'run', 'activate', 'disable', 'rollback']);
const ACTIVE_STATES = new Set(['queued', 'running', 'paused']);

export const INDEPENDENT_CORE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  name: 'BLACKHOLE independent core',
  mode: 'independent',
  bootRequiresModel: false,
  persistenceRequiresModel: false,
  schedulingRequiresModel: false,
  recoveryRequiresModel: false,
  localExecutionRequiresModel: false,
  modelUse: 'bounded-job-only',
  localJobTypes: LOCAL_JOB_TYPES,
  modelJobTypes: MODEL_JOB_TYPES,
  developmentCodeModes: DEVELOPMENT_CODE_MODES,
  localCodeModes: LOCAL_CODE_MODES,
});

function result(kind, requiresModel, trigger, reason) {
  return { schemaVersion: 1, kind, requiresModel, trigger, reason };
}

/**
 * Classify a durable job before displaying or scheduling it. New job types fail
 * closed: they are never silently treated as local or model-free.
 */
export function executionBoundary(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    return result('unclassified', null, 'blocked', 'job record is not an object');
  }
  if (job.type === 'code') {
    const mode = job.codeTask?.mode;
    if (DEVELOPMENT_CODE_MODES.includes(mode)) {
      return result('development-model-call', true, 'development-request', `code:${mode}`);
    }
    if (LOCAL_CODE_MODES.includes(mode)) {
      return result('local-core', false, 'core', `code:${mode}`);
    }
    return result('unclassified', null, 'blocked', 'code mode must be explicitly classified');
  }
  if (job.type === 'agent' && job.repositoryTask) {
    return result('development-model-call', true, 'development-request', 'agent:repository-patch');
  }
  if (MODEL_JOB_TYPES.includes(job.type)) {
    const trigger = job.voiceConversation === true ? 'voice-request'
      : job.researchRequest ? 'research-request'
      : job.botAssignment ? 'project-bot-request'
      : job.shadowAssignment ? 'shadow-army-request'
      : job.autopilot ? 'bounded-autopilot-request'
      : job.questId ? 'goal-run-request'
      : 'explicit-request';
    return result('model-call', true, trigger, `job:${job.type}`);
  }
  if (LOCAL_JOB_TYPES.includes(job.type)) {
    return result('local-core', false, 'core', `job:${job.type}`);
  }
  return result('unclassified', null, 'blocked', 'new job type must be classified before execution');
}

/** A pure point-in-time summary. It never starts, resumes, or calls anything. */
export function independentCoreStatus({
  jobs = [], modelConfigured = false, aiModuleEnabled = false, emergencyStop = false,
} = {}) {
  const records = Array.isArray(jobs) ? jobs : [];
  const classified = records.map(job => ({ job, boundary: executionBoundary(job) }));
  const count = kind => classified.filter(item => item.boundary.kind === kind).length;
  const active = classified.filter(item => ACTIVE_STATES.has(item.job?.status));
  const modelAvailable = modelConfigured === true && aiModuleEnabled === true;
  return {
    schemaVersion: 1,
    mode: INDEPENDENT_CORE_CONTRACT.mode,
    coreReady: true,
    modelOptional: true,
    emergencyStop: emergencyStop === true,
    model: {
      configured: modelConfigured === true,
      moduleEnabled: aiModuleEnabled === true,
      availableForBoundedJobs: modelAvailable,
    },
    guarantees: {
      bootWithoutModel: true,
      persistWithoutModel: true,
      recoverWithoutModel: true,
      scheduleLocalJobsWithoutModel: true,
      unknownJobsFailClosed: true,
    },
    jobs: {
      total: records.length,
      localCore: count('local-core'),
      modelCall: count('model-call'),
      developmentModelCall: count('development-model-call'),
      unclassified: count('unclassified'),
      activeLocalCore: active.filter(item => item.boundary.kind === 'local-core').length,
      activeBlockedByMissingModel: modelAvailable ? 0 : active.filter(item => item.boundary.requiresModel === true).length,
    },
  };
}

/** Static startup assertion used by the hosted entrypoint and tests. */
export function assertIndependentCoreContract() {
  for (const type of LOCAL_JOB_TYPES) {
    const boundary = executionBoundary({ type });
    if (boundary.kind !== 'local-core' || boundary.requiresModel !== false) {
      throw new Error(`Independent core contract failed for local job type: ${type}`);
    }
  }
  for (const type of MODEL_JOB_TYPES) {
    const boundary = executionBoundary({ type });
    if (boundary.kind !== 'model-call' || boundary.requiresModel !== true) {
      throw new Error(`Independent core contract failed for model job type: ${type}`);
    }
  }
  for (const mode of DEVELOPMENT_CODE_MODES) {
    const boundary = executionBoundary({ type: 'code', codeTask: { mode } });
    if (boundary.kind !== 'development-model-call' || boundary.requiresModel !== true) {
      throw new Error(`Independent core contract failed for development mode: ${mode}`);
    }
  }
  for (const mode of LOCAL_CODE_MODES) {
    const boundary = executionBoundary({ type: 'code', codeTask: { mode } });
    if (boundary.kind !== 'local-core' || boundary.requiresModel !== false) {
      throw new Error(`Independent core contract failed for local code mode: ${mode}`);
    }
  }
  return true;
}
