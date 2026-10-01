const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();

export const initialResultRatings = () => ({version:1,entries:[]});

export function validateResultRatings(value, state = null) {
  if (!exact(value,['version','entries']) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 500) throw Error('Invalid result ratings');
  const seen = new Set();
  for (const row of value.entries) {
    if (!exact(row,['jobId','artifactSha256','stars','verificationType','authority','sourceType','ratedAt','authorizesDispatch'])
      || !UUID.test(row.jobId) || !HASH.test(row.artifactSha256) || !Number.isInteger(row.stars) || row.stars < 1 || row.stars > 5
      || row.verificationType !== 'self_reported' || row.authority !== 'owner' || row.sourceType !== 'owner_report'
      || !ISO.test(row.ratedAt) || !Number.isFinite(Date.parse(row.ratedAt)) || row.authorizesDispatch !== false || seen.has(row.jobId)) throw Error('Invalid result rating');
    seen.add(row.jobId);
    if (state !== null) {
      const job = state.jobs?.find(item => item.id === row.jobId);
      if (!job || job.status !== 'completed' || !job.artifacts?.some(item => state.artifacts?.[item.id]?.sha256 === row.artifactSha256)) throw Error('Result rating lacks completed artifact');
    }
  }
  return true;
}

export function recordResultRating(value, state, {jobId,artifactSha256,stars,ratedAt}) {
  validateResultRatings(value,state);
  const row={jobId,artifactSha256,stars,verificationType:'self_reported',authority:'owner',sourceType:'owner_report',ratedAt,authorizesDispatch:false};
  validateResultRatings({version:1,entries:[row]},state);
  const prior=value.entries.find(entry=>entry.jobId===jobId);
  if(prior){if(prior.stars!==stars||prior.artifactSha256!==artifactSha256)throw Error('Rating already recorded for this result');return {ratings:value,row:prior,added:false};}
  const next={version:1,entries:[...value.entries,row]};
  validateResultRatings(next,state);
  return {ratings:next,row,added:true};
}
