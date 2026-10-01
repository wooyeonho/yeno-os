import {randomUUID} from 'node:crypto';
export function passedMission() {
  const missionId=randomUUID(),builderId=randomUUID(),verifierId=randomUUID(),semanticId=randomUUID(),artifactId=randomUUID();
  const at='2026-09-28T00:00:00.000Z';
  const roles=['scout','researcher','builder','verifier','semanticVerifier'];
  const jobs=roles.map(role=>({id:role==='builder'?builderId:role==='verifier'?verifierId:role==='semanticVerifier'?semanticId:randomUUID(),status:'completed',shadowAssignment:{missionId,role},artifacts:[{id:role==='builder'?artifactId:randomUUID()}],createdAt:at,updatedAt:at}));
  jobs[3].verifyResult={verified:true};
  jobs[4].semanticVerdict={version:1,missionId,builderJobId:builderId,verifierJobId:verifierId,artifactRefs:[artifactId],verdict:'pass',createdAt:at};
  // Policy v2 fixture includes an earlier failed attempt at the same goal.
  for(const job of jobs)job.shadowAssignment.goal='복구';
  const failed={id:randomUUID(),status:'failed',shadowAssignment:{missionId:randomUUID(),role:'builder',goal:'복구'},createdAt:'2026-09-27T00:00:00.000Z',updatedAt:'2026-09-27T00:00:00.000Z',artifacts:[]};
  jobs.push(failed);
  return {missionId,jobs,artifacts:{[artifactId]:{id:artifactId,jobId:builderId,sha256:'a'.repeat(64)}},at};
}
