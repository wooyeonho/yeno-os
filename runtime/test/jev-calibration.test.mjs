import test from 'node:test';
import assert from 'node:assert/strict';
import wilson from 'wilson-score-interval';
import {wilsonLowerBound, jevCalibrationEvidence} from '../lib/jev-calibration.mjs';

test('Wilson lower bound uses decided trials and remains below a perfect observed rate', () => {
  assert.equal(wilsonLowerBound(50, 50), wilson(50, 50).left);
  assert.ok(Math.abs(wilsonLowerBound(50, 50) - 0.9286) < 0.0001);
  assert.ok(wilsonLowerBound(29, 30) < wilsonLowerBound(50, 50));
  assert.equal(wilsonLowerBound(0, 30), 0);
  assert.throws(() => wilsonLowerBound(1, 0), TypeError);
  assert.throws(() => wilsonLowerBound(2, 1), TypeError);
});

test('empty real JEV shadow log has no invented confidence or authority', () => {
  assert.deepEqual(jevCalibrationEvidence([]), {
    method: 'wilson-score-two-sided-95', sampleSize: 0, decidedSampleSize: 0,
    matchedCount: 0, falsePositiveCount: 0, matchLowerBound: null,
    authorizesDispatch: false,
  });
});
