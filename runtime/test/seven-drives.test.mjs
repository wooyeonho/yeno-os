import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_CANON, DRIVE_IDS, driveWorldName, driveWorldNameEn, driveCanon } from '../lib/seven-drives.mjs';
import { SEVEN_DRIVES } from '../lib/quests.mjs';
import { DRIVE_DEFINITIONS } from '../lib/motivation.mjs';

test('the canon is a true bijection of seven distinct ids and seven distinct owner-facing names', () => {
  assert.equal(DRIVE_CANON.length, 7);
  assert.equal(new Set(DRIVE_IDS).size, 7);
  assert.equal(new Set(DRIVE_CANON.map(d => d.worldName)).size, 7);
  assert.equal(new Set(DRIVE_CANON.map(d => d.worldNameEn)).size, 7);
  for (const entry of DRIVE_CANON) assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(DRIVE_CANON));
  assert.ok(Object.isFrozen(DRIVE_IDS));
});

test('driveWorldName/driveWorldNameEn/driveCanon resolve every real id and reject unknown ones', () => {
  for (const id of DRIVE_IDS) {
    assert.equal(typeof driveWorldName(id), 'string');
    assert.equal(typeof driveWorldNameEn(id), 'string');
    assert.equal(driveCanon(id).id, id);
  }
  assert.equal(driveWorldName('not-a-real-drive'), null);
  assert.equal(driveWorldNameEn('not-a-real-drive'), null);
  assert.equal(driveCanon('not-a-real-drive'), null);
});

test('quests.mjs SEVEN_DRIVES and motivation.mjs DRIVE_DEFINITIONS both carry the same canonical world names for every id, without altering their own existing ids/labels', () => {
  assert.deepEqual(SEVEN_DRIVES.map(d => d.id).sort(), [...DRIVE_IDS].sort());
  assert.deepEqual(DRIVE_DEFINITIONS.map(d => d.id).sort(), [...DRIVE_IDS].sort());
  for (const drive of SEVEN_DRIVES) {
    assert.equal(drive.worldName, driveWorldName(drive.id));
    assert.equal(drive.worldNameEn, driveWorldNameEn(drive.id));
    assert.equal(typeof drive.name, 'string');
    assert.equal(typeof drive.goal, 'string');
  }
  for (const drive of DRIVE_DEFINITIONS) {
    assert.equal(drive.worldName, driveWorldName(drive.id));
    assert.equal(drive.worldNameEn, driveWorldNameEn(drive.id));
    assert.equal(typeof drive.description, 'string');
    assert.ok(Object.isFrozen(drive));
  }
});
