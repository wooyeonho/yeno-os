import * as engine from './provider-config-engine.mjs';

export * from './provider-config-engine.mjs';

function developmentBackgroundAllowed(env={}) {
  const runtimeEnv={...process.env,...env};
  return runtimeEnv.NODE_ENV!=='production'
    && runtimeEnv.YENO_DEVELOPMENT_BACKGROUND_MODEL_CALLS==='true';
}
function applyPolicy(config,env) {
  const runtimeEnv={...process.env,...env};
  const development=developmentBackgroundAllowed(env);
  return {
    ...config,
    auto: development && runtimeEnv.YENO_AGENT_AUTORUN==='true',
    backgroundModelCalls: development,
  };
}

export function agentConfig(env={}) {
  return applyPolicy(engine.agentConfig(env),env);
}
export function agentConfigForProvider(env={},provider) {
  return applyPolicy(engine.agentConfigForProvider(env,provider),env);
}
export function agentProfiles(env={}) {
  return Object.fromEntries(Object.entries(engine.agentProfiles(env)).map(([name,config])=>[name,applyPolicy(config,env)]));
}
