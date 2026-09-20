// BLACKHOLE Browser Decision Adapter (Jev Ultrafast-inspired, read-only first).
//
// This is deliberately a policy/contract layer, not a browser driver and not
// a claim that a live TypeSafe or Chrome provider is configured. It converts a
// bounded indexed DOM snapshot plus a typed decision into an allowlisted action
// plan. A later Browser Harness may execute only a plan accepted here.
//
// Security boundary:
// - no arbitrary JavaScript, shell, navigation command, credential value or
//   keyboard shortcut is accepted;
// - sensitive fields are redacted before any decision payload is created;
// - a decision is valid only for the exact snapshot revision it observed;
// - buttons/forms that may submit, publish, purchase or authenticate are blocked
//   in the read-only mode;
// - DONE is never proof by itself: an independent outcome evidence record is
//   required by the caller.

export const BROWSER_DECISION_VERSION = 1;
export const BROWSER_OPERATIONS = Object.freeze([
  'CLICK', 'TYPE_TEXT', 'SELECT', 'SCROLL_UP', 'SCROLL_DOWN', 'WAIT', 'DONE', 'BLOCKED',
]);
export const BROWSER_SAFE_ROLES = Object.freeze(['link', 'tab', 'option', 'combobox', 'textbox']);
export const BROWSER_POLICY_STATUS = 'sandbox-indexed-dom';
export const MAX_DOM_ELEMENTS = 200;
export const MAX_DOM_TEXT = 600;
export const MAX_DECISION_TEXT = 500;
export const MAX_GOAL_TEXT = 1200;
export const MAX_EVIDENCE_REFS = 8;

export class BrowserDecisionError extends Error {
  constructor(code, evidence) {
    super(evidence ? `${code}: ${evidence}` : code);
    this.code = code;
  }
}
const fail = (code, evidence) => { throw new BrowserDecisionError(code, evidence); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const nonEmpty = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = value => Number.isInteger(value) && value >= 0;
const SAFE_URL = /^https?:\/\/[^\s\\<>"']+$/i;
const SENSITIVE = /(?:password|passwd|passcode|secret|token|api[ _-]?key|private[ _-]?key|recovery|seed phrase|신분증|비밀번호|암호|토큰|키)/i;

const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const sensitiveField = element => element.sensitive === true
  || SENSITIVE.test([element.role, element.name, element.label, element.ariaLabel, element.inputType].filter(Boolean).join(' '));

function normalizeElement(element, position) {
  if (!object(element)) fail('invalid_dom_element');
  const fields = ['index', 'role', 'text', 'ariaLabel', 'name', 'label', 'inputType', 'enabled', 'visible', 'href', 'sensitive'];
  if (Object.keys(element).some(key => !fields.includes(key))) fail('unknown_dom_element_field', String(position));
  const index = element.index ?? position;
  if (!integer(index) || index > 100000) fail('invalid_dom_index', String(index));
  const role = typeof element.role === 'string' ? element.role.trim().toLowerCase() : '';
  if (!role || role.length > 60) fail('invalid_dom_role', String(index));
  const isSensitive = sensitiveField(element);
  const normalized = {
    index,
    role,
    text: isSensitive ? '[redacted]' : clip(element.text, MAX_DOM_TEXT),
    ariaLabel: isSensitive ? '[redacted]' : clip(element.ariaLabel, MAX_DOM_TEXT),
    name: isSensitive ? '[redacted]' : clip(element.name, 120),
    label: isSensitive ? '[redacted]' : clip(element.label, MAX_DOM_TEXT),
    inputType: clip(element.inputType, 40).toLowerCase() || null,
    enabled: element.enabled !== false,
    visible: element.visible !== false,
    href: element.href === undefined || element.href === null ? null : String(element.href),
    sensitive: isSensitive,
  };
  if (normalized.href !== null && (!nonEmpty(normalized.href, 2000) || !SAFE_URL.test(normalized.href))) fail('invalid_dom_href', String(index));
  return normalized;
}

export function validateIndexedDomSnapshot(snapshot) {
  if (!object(snapshot)) fail('invalid_dom_snapshot');
  const keys = ['url', 'title', 'revision', 'observedAt', 'elements'];
  if (Object.keys(snapshot).some(key => !keys.includes(key))) fail('unknown_dom_snapshot_field');
  if (!nonEmpty(snapshot.url, 2000) || !SAFE_URL.test(snapshot.url)) fail('invalid_dom_snapshot_url');
  if (!nonEmpty(snapshot.title, MAX_DOM_TEXT)) fail('invalid_dom_snapshot_title');
  if (!integer(snapshot.revision) || snapshot.revision > 1000000000) fail('invalid_dom_snapshot_revision');
  if (typeof snapshot.observedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.observedAt))) fail('invalid_dom_snapshot_time');
  if (!Array.isArray(snapshot.elements) || snapshot.elements.length > MAX_DOM_ELEMENTS) fail('invalid_dom_elements');
  const elements = snapshot.elements.map(normalizeElement);
  const indexes = new Set();
  for (const element of elements) {
    if (indexes.has(element.index)) fail('duplicate_dom_index', String(element.index));
    indexes.add(element.index);
  }
  return {
    version: BROWSER_DECISION_VERSION,
    url: snapshot.url,
    title: clip(snapshot.title, MAX_DOM_TEXT),
    revision: snapshot.revision,
    observedAt: snapshot.observedAt,
    elements,
  };
}

export function indexedDomDecisionInput({snapshot, goal}) {
  const normalized = validateIndexedDomSnapshot(snapshot);
  if (!nonEmpty(goal, MAX_GOAL_TEXT)) fail('invalid_browser_goal');
  return {
    version: BROWSER_DECISION_VERSION,
    goal: goal.trim(),
    page: {url: normalized.url, title: normalized.title, revision: normalized.revision},
    elements: normalized.elements.filter(element => element.visible).map(element => ({
      index: element.index,
      role: element.role,
      text: element.text,
      ariaLabel: element.ariaLabel,
      label: element.label,
      inputType: element.inputType,
      enabled: element.enabled,
      href: element.href,
      sensitive: element.sensitive,
    })),
    operations: [...BROWSER_OPERATIONS],
    policy: {
      mode: 'read-only',
      externalActions: false,
      credentials: false,
      independentDoneEvidence: true,
    },
  };
}

const DECISION_FIELDS = ['operation', 'targetIndex', 'text', 'option', 'reason', 'snapshotRevision'];
export function parseBrowserDecisionDraft(raw) {
  let draft = raw;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw) > 8192) fail('decision_output_limit');
    try { draft = JSON.parse(raw.trim().replace(/^\`\`\`(?:json)?\\s*\\n([\\s\\S]*?)\\n\`\`\`$/, '$1')); }
    catch { fail('invalid_decision_json', clip(raw, 300)); }
  }
  if (!exact(draft, DECISION_FIELDS)) fail('invalid_decision_shape');
  if (!BROWSER_OPERATIONS.includes(draft.operation)) fail('invalid_browser_operation');
  if (draft.targetIndex !== null && (!integer(draft.targetIndex) || draft.targetIndex > 100000)) fail('invalid_browser_target');
  if (draft.text !== null && !nonEmpty(draft.text, MAX_DECISION_TEXT)) fail('invalid_browser_text');
  if (draft.option !== null && !nonEmpty(draft.option, 200)) fail('invalid_browser_option');
  if (!nonEmpty(draft.reason, 600)) fail('invalid_browser_reason');
  if (!integer(draft.snapshotRevision)) fail('invalid_browser_snapshot_revision');
  if (draft.operation === 'TYPE_TEXT' && !draft.text) fail('missing_browser_text');
  if (draft.operation === 'SELECT' && !draft.option) fail('missing_browser_option');
  if (['CLICK', 'TYPE_TEXT', 'SELECT'].includes(draft.operation) && draft.targetIndex === null) fail('missing_browser_target');
  if (!['CLICK', 'TYPE_TEXT', 'SELECT'].includes(draft.operation) && draft.targetIndex !== null) fail('unexpected_browser_target');
  return {...draft, text: draft.text ?? null, option: draft.option ?? null};
}

function targetFor(snapshot, index) {
  const target = snapshot.elements.find(element => element.index === index);
  if (!target) fail('browser_target_not_found', String(index));
  if (!target.visible) fail('browser_target_not_visible', String(index));
  if (!target.enabled) fail('browser_target_disabled', String(index));
  return target;
}

function targetRoleAllowed(operation, target) {
  if (operation === 'CLICK') return ['link', 'tab', 'option'].includes(target.role);
  if (operation === 'TYPE_TEXT') return target.role === 'textbox';
  if (operation === 'SELECT') return target.role === 'combobox';
  return true;
}

export function planBrowserAction({snapshot, draft, independentOutcome = null}) {
  const page = validateIndexedDomSnapshot(snapshot);
  const action = parseBrowserDecisionDraft(draft);
  if (action.snapshotRevision !== page.revision) fail('stale_browser_snapshot');
  if (action.operation === 'BLOCKED') {
    return {version: BROWSER_DECISION_VERSION, action, dispatchAllowed: false, requiresOwnerApproval: false, reason: action.reason};
  }
  if (action.operation === 'DONE') {
    if (!object(independentOutcome) || independentOutcome.status !== 'verified') fail('done_requires_independent_verification');
    if (!Array.isArray(independentOutcome.evidenceRefs) || independentOutcome.evidenceRefs.length > MAX_EVIDENCE_REFS || independentOutcome.evidenceRefs.some(ref => !nonEmpty(ref, 200))) fail('invalid_done_evidence');
    return {version: BROWSER_DECISION_VERSION, action, dispatchAllowed: false, requiresOwnerApproval: false, independentlyVerified: true, evidenceRefs: [...independentOutcome.evidenceRefs]};
  }
  if (['SCROLL_UP', 'SCROLL_DOWN', 'WAIT'].includes(action.operation)) {
    return {version: BROWSER_DECISION_VERSION, action, dispatchAllowed: false, requiresOwnerApproval: false, independentlyVerified: false};
  }
  const target = targetFor(page, action.targetIndex);
  if (target.sensitive) fail('sensitive_target_blocked');
  if (!targetRoleAllowed(action.operation, target)) fail('unsafe_target_role', target.role);
  // Read-only mode does not submit forms, follow authentication controls, or
  // activate arbitrary buttons. A future owner-approved side-effect mode must
  // be a separate explicitly reviewed contract.
  if (action.operation === 'CLICK' && target.href && !SAFE_URL.test(target.href)) fail('unsafe_navigation');
  return {
    version: BROWSER_DECISION_VERSION,
    action,
    target: {index: target.index, role: target.role, text: target.text, href: target.href},
    dispatchAllowed: false,
    requiresOwnerApproval: false,
    independentlyVerified: false,
  };
}

export function browserDecisionStatus() {
  return {
    status: BROWSER_POLICY_STATUS,
    liveProvider: false,
    liveBrowserHarness: false,
    externalActions: false,
    credentialInput: false,
    indexedDom: true,
    independentOutcomeVerification: true,
    operations: [...BROWSER_OPERATIONS],
    limitations: [
      'policy only; no Chrome/Browser Harness process is connected',
      'TypeSafe Jev provider key/endpoint is not configured here',
      'login, password/token input, purchase, publish and arbitrary buttons are blocked',
    ],
  };
}
