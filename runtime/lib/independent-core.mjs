import * as engine from './independent-core-engine.mjs';

export const INDEPENDENT_CORE_CONTRACT=engine.INDEPENDENT_CORE_CONTRACT;
export const assertIndependentCoreContract=engine.assertIndependentCoreContract;
const ACTIVE_STATES=new Set(['queued','running','paused']);

// Public job views intentionally omit private codeTask payloads. Their bounded
// code.mode field is sufficient to preserve the already-derived boundary when
// producing status summaries; unknown modes still fail closed.
export function executionBoundary(job) {
  if(job?.type==='code'&&!job.codeTask&&typeof job.code?.mode==='string') {
    return engine.executionBoundary({...job,codeTask:{mode:job.code.mode}});
  }
  return engine.executionBoundary(job);
}

export function independentCoreStatus({
  jobs=[],modelConfigured=false,aiModuleEnabled=false,emergencyStop=false,
}={}) {
  const records=Array.isArray(jobs)?jobs:[];
  const classified=records.map(job=>({job,boundary:executionBoundary(job)}));
  const count=kind=>classified.filter(item=>item.boundary.kind===kind).length;
  const active=classified.filter(item=>ACTIVE_STATES.has(item.job?.status));
  const modelAvailable=modelConfigured===true&&aiModuleEnabled===true;
  return {
    schemaVersion:1,
    mode:INDEPENDENT_CORE_CONTRACT.mode,
    coreReady:true,
    modelOptional:true,
    emergencyStop:emergencyStop===true,
    model:{configured:modelConfigured===true,moduleEnabled:aiModuleEnabled===true,availableForBoundedJobs:modelAvailable},
    guarantees:{bootWithoutModel:true,persistWithoutModel:true,recoverWithoutModel:true,scheduleLocalJobsWithoutModel:true,unknownJobsFailClosed:true},
    jobs:{
      total:records.length,
      localCore:count('local-core'),
      modelCall:count('model-call'),
      developmentModelCall:count('development-model-call'),
      unclassified:count('unclassified'),
      activeLocalCore:active.filter(item=>item.boundary.kind==='local-core').length,
      activeBlockedByMissingModel:modelAvailable?0:active.filter(item=>item.boundary.requiresModel===true).length,
    },
  };
}
