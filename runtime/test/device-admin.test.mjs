import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceAdminError, publicDevices, revokeDevice } from '../lib/device-admin.mjs';

const LOST = '0a638c46-e07f-4438-9929-28f75255f445';
const OTHER = '9934429e-76a8-42ae-829a-7825c0d7f07d';
const MISSING = 'f67705f3-bc8a-45d7-b8db-d397bfaa7c4d';
function fixture() {
  const device = (id, name) => ({
    id, name, platform: 'android', createdAt: '2026-09-09T00:00:00.000Z',
    lastSeenAt: '2026-09-09T01:00:00.000Z', revokedAt: null,
    tokenHash: `PRIVATE_TOKEN_HASH_${id}`, deviceToken: 'LEGACY_PRIVATE_TOKEN',
    unknownFutureSecret: { value: 'PRIVATE_FUTURE_SECRET' },
  });
  return { devices: { [LOST]: device(LOST, '분실한 폰'), [OTHER]: device(OTHER, '사용 중인 폰') },
    revision: 17, jobs: [{ id: 'retained-job', status: 'running' }], requests: { retained: { hash: 'retained' } },
  };
}

test('owner device listing exposes only detached public scalar metadata', () => {
  const state = fixture(), before = structuredClone(state);
  const devices = publicDevices(state);
  assert.equal(devices.length, 2);
  assert.deepEqual(Object.keys(devices[0]), ['id', 'name', 'platform', 'createdAt', 'lastSeenAt', 'revokedAt']);
  assert.doesNotMatch(JSON.stringify(devices), /PRIVATE|tokenHash|deviceToken|unknownFutureSecret/);
  assert.equal(devices[0].id, LOST);
  devices[0].name = 'changed view';
  assert.deepEqual(state, before, 'listing and editing its returned metadata cannot change persisted records');
  assert.deepEqual(publicDevices({ devices: {} }), []);
  state.devices[LOST].name = { secret: 'PRIVATE_NESTED' };
  assert.throws(() => publicDevices(state), /Invalid device record/, 'malformed metadata must not leak nested secrets');
});

test('targeted lost-phone revocation needs no device bearer and preserves other devices, jobs and pairing-independent hashes', () => {
  const state = fixture(), before = structuredClone(state);
  const result = revokeDevice(state, LOST);
  assert.deepEqual(result, { revoked: true, deviceId: LOST, alreadyRevoked: false });
  const revokedAt = state.devices[LOST].revokedAt;
  assert.equal(new Date(revokedAt).toISOString(), revokedAt);
  const expected = structuredClone(before);
  expected.devices[LOST].revokedAt = revokedAt;
  assert.deepEqual(state, expected, 'only the selected revocation marker changes; no jobs or other credentials are removed');
  assert.deepEqual(revokeDevice(state, LOST), { revoked: true, deviceId: LOST, alreadyRevoked: true });
  assert.equal(state.devices[LOST].revokedAt, revokedAt, 'repeated revocation preserves the first revocation time');
  assert.equal(publicDevices(state).find(device => device.id === LOST).revokedAt, revokedAt);
});

test('malformed, missing and inherited device IDs cannot mutate the registry', () => {
  const state = fixture(), before = structuredClone(state);
  for (const id of [undefined, null, 1, {}, [], '', '__proto__', 'constructor', 'toString', `../${LOST}`, `${LOST} `, LOST.toUpperCase()]) {
    assert.throws(() => revokeDevice(state, id), error => error instanceof DeviceAdminError && error.status === 400);
  }
  assert.throws(() => revokeDevice(state, MISSING), error => error instanceof DeviceAdminError && error.status === 404);
  assert.deepEqual(state, before);
  const inherited = Object.create({ [MISSING]: { ...before.devices[LOST], id: MISSING } });
  inherited[OTHER] = before.devices[OTHER];
  assert.deepEqual(publicDevices({ devices: inherited }).map(device => device.id), [OTHER]);
  assert.throws(() => revokeDevice({ devices: inherited }, MISSING), error => error instanceof DeviceAdminError && error.status === 404);
  state.devices[LOST].id = OTHER;
  assert.throws(() => revokeDevice(state, LOST), /Invalid device record/);
  assert.equal(state.devices[LOST].revokedAt, null);
});
