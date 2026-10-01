import {validateSkillHistory} from './solo-leveling.mjs';

// Report-only comparison of terminal execution verification. This does not
// measure output quality or business outcomes and never changes a grade.
export const EXECUTION_TREND_WINDOW = 5;

export function executionTrend(history) {
  validateSkillHistory(history);
  const terminal = [
    ...history.successes.map(item => ({at: item.at, jobId: item.jobId, verified: true})),
    ...history.failures.map(item => ({at: item.at, jobId: item.jobId, verified: false})),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.jobId.localeCompare(b.jobId));
  const observed = terminal.length;
  if (observed < 2 * EXECUTION_TREND_WINDOW) return {status: 'insufficient_evidence', windowSize: EXECUTION_TREND_WINDOW, observed, previous: null, latest: null};
  const count = items => ({verified: items.filter(item => item.verified).length, total: EXECUTION_TREND_WINDOW});
  const previous = count(terminal.slice(-2 * EXECUTION_TREND_WINDOW, -EXECUTION_TREND_WINDOW));
  const latest = count(terminal.slice(-EXECUTION_TREND_WINDOW));
  const drop = previous.verified - latest.verified;
  const status = drop >= 2 ? 'declining' : drop === 1 ? 'watch' : drop < 0 ? 'improving' : 'stable';
  return {status, windowSize: EXECUTION_TREND_WINDOW, observed, previous, latest};
}
