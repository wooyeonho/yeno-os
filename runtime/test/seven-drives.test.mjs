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

test('E1 restores original sin labels while preserving canonical identity and territory', () => {
  // Intentional display change: pride/lust no longer use the softened 긍지/매혹 labels.
  assert.deepEqual(DRIVE_CANON.map(drive => [drive.id, drive.label, drive.legacyName, drive.worldName]), [
    ['greed', '강욕', '강욕', '부'], ['gluttony', '폭식', '폭식', '지식'],
    ['envy', '질투', '질투', '영향력'], ['pride', '오만', '오만', '명예'],
    ['lust', '색욕', '색욕', '창조'], ['wrath', '분노', '분노', '진화'], ['sloth', '나태', '나태', '자유'],
  ]);
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
