import {calibrateShadowLog} from './jev.mjs';
import wilson from 'wilson-score-interval';

export function wilsonLowerBound(successes, trials) {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(trials)
      || trials < 1 || successes < 0 || successes > trials) {
    throw new TypeError('Wilson interval requires integer successes within nonzero trials.');
  }
  return Math.max(0, wilson(successes, trials).left);
}

export function jevCalibrationEvidence(log) {
  const calibration = calibrateShadowLog(log);
  const decidedSampleSize = calibration.byStatus.decided;
  const matchedCount = log.filter(entry => entry.jevStatus === 'decided' && entry.matchedRealDecision).length;
  const falsePositiveCount = log.filter(entry => entry.jevAnswer === 'dispatch' && entry.realDecision === 'hold').length;
  return {
    method: 'wilson-score-two-sided-95',
    sampleSize: calibration.sampleSize,
    decidedSampleSize,
    matchedCount,
    falsePositiveCount,
    matchLowerBound: decidedSampleSize === 0 ? null : wilsonLowerBound(matchedCount, decidedSampleSize),
    authorizesDispatch: false,
  };
}
