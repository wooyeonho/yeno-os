// S12 policy projection. This never authenticates a caller or issues a command;
// the HTTP boundary must establish the principal before using this read model.
const POLICIES = Object.freeze({
  browser: Object.freeze({read:['status','night-report-summary','review-draft-count'],write:['mission-request'],denied:['code-activation','credential-entry-by-agent']}),
  android: Object.freeze({read:['status','night-report-summary','review-draft-count'],write:['mission-request'],denied:['code-activation','credential-entry-by-agent','draft-approval']}),
  voice: Object.freeze({read:['status'],write:[],denied:['code-activation','draft-approval','mission-request']}),
  telegram: Object.freeze({read:[],write:[],denied:['status-disclosure','code-activation','draft-approval','mission-request']}),
});

export function channelPolicy(channel) {
  if (!Object.hasOwn(POLICIES,channel)) throw Error('Unsupported channel');
  return structuredClone({channel,...POLICIES[channel],authorizesDispatch:false});
}

export function channelOverview(state,channel) {
  if (channel !== 'browser' && channel !== 'android') throw Error('Authenticated channel required');
  const policy=channelPolicy(channel);
  const reports=state.nightCycle?.reports ?? [];
  const drafts=state.absorbInbox?.entries ?? [];
  const latest=reports.at(-1);
  return {policy,emergencyStop:state.emergencyStop===true,
    nightReport:latest?{cycleDate:latest.cycleDate,sha256:latest.sha256}:null,
    reviewDraftCount:drafts.filter(entry=>entry.status==='draft').length,
    authorizesDispatch:false};
}
