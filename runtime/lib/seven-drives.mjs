// BLACKHOLE Seven Drives — single canonical identity (Phase C, issue #25).
//
// Before this file, the seven drives existed as two independent, hand-kept
// lists that happened to share the same seven ids: quests.mjs's SEVEN_DRIVES
// (goal/evidence text for quest assignment) and motivation.mjs's
// DRIVE_DEFINITIONS (scoring-weight descriptions for the autopilot ranking
// engine). That duplication is exactly what the FINAL Living Interface
// contract's Phase C instructions warn against ("reconcile the existing
// runtime drive system instead of creating an unrelated duplicate system").
//
// This module is the reconciliation: the one place `id` and both label
// forms live, imported by both quests.mjs and motivation.mjs so they can
// never drift apart again. It changes NOTHING persisted or displayed today:
// - `id` is byte-for-byte the same seven values already stored in every
//   quest record's `driveId` (greed/gluttony/envy/pride/lust/wrath/sloth) -
//   changing these would corrupt every persisted quest.
// - `legacyName`/`label` are the exact Korean strings quests.mjs/
//   motivation.mjs already display today (including quests.mjs's own prior
//   partial softening of pride->긍지 and lust->매혹) - existing UI/tests that
//   assert on this text keep working unchanged.
// - `worldName`/`worldNameEn` are NEW, additive fields: the owner-facing
//   semantic vocabulary the Phase C contract asks for (Wealth/Evolution/
//   Knowledge/Freedom/Honor/Influence/Creation). Nothing reads them yet
//   except the new Core summary field added alongside this file - existing
//   call sites are free to keep showing legacyName/label until a later UI
//   slice deliberately switches them over.
//
// The id->world-name mapping is a deliberate, documented judgment call, not
// an arbitrary relabeling - each pairing follows the ALREADY-REAL behavior
// each drive's signals reward (see motivation.mjs's scoreMotivation()),
// not just a vibe match to the old sin-name:
//   greed    (accumulate reusable result assets)          -> Wealth     (부)
//   gluttony (fill stale/missing public evidence gaps)     -> Knowledge  (지식)
//   envy     (catch up lagging verification vs portfolio)  -> Influence  (영향력)
//   pride    (reduce evidence/format verification gaps)    -> Honor      (명예)
//   lust     (finish owner-consumable results)             -> Creation   (창조)
//   wrath    (learn from real failure, avoid uncertainty)  -> Evolution  (진화)
//   sloth    (reuse existing results without new calls)    -> Freedom    (자유)
// This is a bijection: every one of the seven owner-facing names is used
// exactly once, and validated as such below so the mapping can never
// silently become partial or duplicated as this file changes.
export const DRIVE_CANON = Object.freeze([
  {id: 'greed', legacyName: '강욕', label: '강욕', worldName: '부', worldNameEn: 'Wealth'},
  {id: 'gluttony', legacyName: '폭식', label: '폭식', worldName: '지식', worldNameEn: 'Knowledge'},
  {id: 'envy', legacyName: '질투', label: '질투', worldName: '영향력', worldNameEn: 'Influence'},
  {id: 'pride', legacyName: '오만', label: '긍지', worldName: '명예', worldNameEn: 'Honor'},
  {id: 'lust', legacyName: '색욕', label: '매혹', worldName: '창조', worldNameEn: 'Creation'},
  {id: 'wrath', legacyName: '분노', label: '분노', worldName: '진화', worldNameEn: 'Evolution'},
  {id: 'sloth', legacyName: '나태', label: '나태', worldName: '자유', worldNameEn: 'Freedom'},
].map(entry => Object.freeze(entry)));

export const DRIVE_IDS = Object.freeze(DRIVE_CANON.map(entry => entry.id));

(function assertCanonIsABijection() {
  const ids = new Set(DRIVE_CANON.map(e => e.id));
  const worldNames = new Set(DRIVE_CANON.map(e => e.worldName));
  const worldNamesEn = new Set(DRIVE_CANON.map(e => e.worldNameEn));
  if (ids.size !== 7 || worldNames.size !== 7 || worldNamesEn.size !== 7) {
    throw new Error('DRIVE_CANON must be a bijection: seven distinct ids, each mapped to a distinct owner-facing name.');
  }
})();

export function driveWorldName(id) {
  return DRIVE_CANON.find(entry => entry.id === id)?.worldName ?? null;
}
export function driveWorldNameEn(id) {
  return DRIVE_CANON.find(entry => entry.id === id)?.worldNameEn ?? null;
}
export function driveCanon(id) {
  return DRIVE_CANON.find(entry => entry.id === id) ?? null;
}
