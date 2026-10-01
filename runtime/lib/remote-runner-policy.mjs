// The actual mTLS listener and owner-owned second machine do not exist yet.
// This table is a deny-by-default contract for the future adapter.
export const REMOTE_RUNNER_ROLES=Object.freeze(['scout','builder']);
export const REMOTE_RUNNER_DENIED=Object.freeze(['state.write','capability.activate','code.promote','owner.approve','payment','credential.read']);
export function remoteRunnerDecision({transport,peerFingerprint,ownerFingerprints,role,action}){
 const trusted=transport==='https-mutual-tls'&&typeof peerFingerprint==='string'&&/^[a-f0-9]{64}$/.test(peerFingerprint)&&Array.isArray(ownerFingerprints)&&ownerFingerprints.includes(peerFingerprint);
 const allowed=trusted&&REMOTE_RUNNER_ROLES.includes(role)&&action==='worker.execute';
 return {allowed,reason:allowed?'scoped_worker_only':'remote_runner_denied',authorizesDispatch:false,stateStorage:'primary-only'};
}
