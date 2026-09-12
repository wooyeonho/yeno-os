// One redaction path for state, initial replies and evicted receipt recovery.
export function publicJob(job) {
  const {input,normalized,draft,agentJournal,botAssignment,worldSnapshot,productionEvidence,...out}=job;
  return {...out,...(botAssignment?{bot:{profile:botAssignment.profile,batchId:botAssignment.batchId,projectVersion:botAssignment.projectVersion,executionScope:'project-draft'}}:{}),...(agentJournal?{agent:{provider:agentJournal.provider,model:agentJournal.model,calls:agentJournal.calls.length,unknownCalls:agentJournal.calls.filter(call=>call.status!=='settled').length,toolResults:agentJournal.history.filter(message=>message.role==='tool').length}}:{})};
}
