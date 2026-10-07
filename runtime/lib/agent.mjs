export {
  AgentError,
  agentConfig,
  agentConfigForProvider,
  agentProfiles,
  AGENT_TOOLS,
  validateAgentJournal,
  recoverAgentJournals,
  agentUsage,
  boundedJson,
  agentTool,
  runAgent,
} from './agent-engine.mjs';

import {automaticMission as engineAutomaticMission} from './agent-engine.mjs';

export function automaticMission(state, config) {
  if (config?.backgroundModelCalls !== true) return null;
  return engineAutomaticMission(state, config);
}
