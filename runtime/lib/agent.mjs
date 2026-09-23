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
  dailyCostUsage,
  dailyCostLimitStatus,
  estimateCallCostUsd,
  priceFor,
  PROVIDER_UNIT_PRICES_SNAPSHOT,
  COST_LEDGER_VERSION,
} from './agent-engine.mjs';

import {automaticMission as engineAutomaticMission} from './agent-engine.mjs';

export function automaticMission(state, config) {
  if (config?.backgroundModelCalls !== true) return null;
  return engineAutomaticMission(state, config);
}
