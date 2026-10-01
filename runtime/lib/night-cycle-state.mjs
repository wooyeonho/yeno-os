const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const minute = value => Number.isInteger(value) && value >= 0 && value < 1440;
const validIds = value => Array.isArray(value) && value.length <= 2000
  && value.every(item => typeof item === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item));

export const initialNightCycle = () => ({version:1,window:null,reports:[],authorizesDispatch:false});
export function validateNightCycle(value) {
  if (!exact(value,['version','window','reports','authorizesDispatch']) || value.version !== 1 || value.authorizesDispatch !== false
    || !Array.isArray(value.reports) || value.reports.length > 366) throw Error('Invalid night cycle');
  if (value.window !== null) {
    const w=value.window;
    if (!exact(w,['timeZone','startMinute','endMinute']) || typeof w.timeZone !== 'string' || w.timeZone.length > 80
      || !minute(w.startMinute) || !minute(w.endMinute) || w.startMinute === w.endMinute) throw Error('Invalid night window');
    try { new Intl.DateTimeFormat('en-US',{timeZone:w.timeZone}).format(0); }
    catch { throw Error('Invalid night time zone'); }
  }
  const ids=new Set();
  for(const report of value.reports){
    if(!exact(report,['cycleDate','ranAt','summary','markdown','sha256','authorizesDispatch'])
      || !date(report.cycleDate) || !iso(report.ranAt) || typeof report.markdown !== 'string' || report.markdown.length > 20000
      || !hash(report.sha256) || createHash('sha256').update(report.markdown).digest('hex') !== report.sha256
      || report.authorizesDispatch !== false || ids.has(report.cycleDate)) throw Error('Invalid night report');
    const s=report.summary;
    if(!exact(s,['failures','staleGapIds','duplicateArtifactHashes','reusableCapabilityIds','beautyDraftIds','modelCalls'])
      || !Array.isArray(s.failures) || !Array.isArray(s.staleGapIds) || !Array.isArray(s.duplicateArtifactHashes)
      || !Array.isArray(s.reusableCapabilityIds) || !Array.isArray(s.beautyDraftIds) || s.modelCalls !== 0) throw Error('Invalid night summary');
    if(s.failures.length>2000 || !s.failures.every(row=>exact(row,['code','count','jobIds'])
      && typeof row.code==='string' && /^[a-z][a-z0-9_]{1,79}$/.test(row.code)
      && Number.isInteger(row.count) && row.count>0 && validIds(row.jobIds) && row.count===row.jobIds.length)
      || !validIds(s.staleGapIds) || !validIds(s.reusableCapabilityIds) || !validIds(s.beautyDraftIds)
      || s.duplicateArtifactHashes.length>2000 || !s.duplicateArtifactHashes.every(hash)) throw Error('Invalid night summary');
    ids.add(report.cycleDate);
  }
  return true;
}
import {createHash} from 'node:crypto';
