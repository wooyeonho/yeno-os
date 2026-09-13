import {publicJob as enginePublicJob} from './job-view-engine.mjs';

// Type-less legacy receipt records predate execution-boundary metadata. Keep
// their exact replay shape while all real typed jobs expose the new boundary.
export function publicJob(job) {
  const value=enginePublicJob(job);
  if(typeof job?.type==='string')return value;
  const {execution,...legacy}=value;
  return legacy;
}
