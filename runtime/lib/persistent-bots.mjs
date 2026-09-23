import {randomUUID} from 'node:crypto';

export const PERSISTENT_BOT_SCHEMA_VERSION = 1;
const BOT_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const ROUTINE_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
const BOT_STATUSES = new Set(['idle','running','paused','blocked']);
const ROUTINE_KINDS = new Set(['manual','schedule','event']);
const MEMORY_KINDS = new Set(['source','decision','constraint','result','risk']);
const CONFIDENCES = new Set(['high','medium','low']);
const DISPOSITIONS = new Set(['candidate','adopted','rejected','unverified']);
const MAX_BOTS = 12;
const MAX_MEMORY_PER_BOT = 200;
const MAX_HANDOFFS = 200;
const MAX_EVENTS = 300;

export class PersistentBotError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'PersistentBotError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const BLUEPRINTS = [
  {
    id: 'jarvis',
    name: 'Jarvis',
    role: 'owner-facing coordinator',
    description: '소유자의 목표를 분해하고 봇 사이의 승인 대기 인계를 관리한다.',
    tools: ['state.read', 'project.read', 'source.read', 'handoff.create'],
    connection: 'local-runtime',
    routines: [{
      id: 'daily-priority-brief',
      name: '오늘의 우선순위 브리핑',
      trigger: {kind: 'manual', value: null},
      objective: '검증된 자료와 현재 프로젝트 상태만 사용해 다음 한 가지 행동을 제안한다.',
      inputRefs: ['state', 'projects', 'sources'],
      requiresOwnerApproval: true
    }]
  },
  {
    id: 'scout',
    name: 'Scout',
    role: 'source and opportunity scout',
    description: '공식 문서와 공개 자료를 분류하고 출처·권리·보안 위험을 기록한다.',
    tools: ['source.read', 'source.classify', 'evidence.record'],
    connection: 'local-runtime',
    routines: [{
      id: 'reference-triage',
      name: '출처 원장 분류',
      trigger: {kind: 'event', value: 'source.reviewed'},
      objective: '새 자료를 기능 후보, 관찰, 보류, 폐기로 분류하고 공식 근거를 붙인다.',
      inputRefs: ['source', 'evidence'],
      requiresOwnerApproval: true
    }]
  },
  {
    id: 'eureka',
    name: 'EUREKA',
    role: 'research and verification',
    description: '가설을 실험·반증·근거 추적으로 바꾸며 성공과 실패를 모두 보존한다.',
    tools: ['research.plan', 'research.review', 'evidence.record'],
    connection: 'local-runtime',
    routines: [{
      id: 'claim-verification',
      name: '주장 검증 루프',
      trigger: {kind: 'manual', value: null},
      objective: '주장을 출처, 재현 가능한 시험, 남은 불확실성으로 분해한다.',
      inputRefs: ['source', 'research', 'outcomes'],
      requiresOwnerApproval: true
    }]
  },
  {
    id: 'studio',
    name: 'Studio',
    role: 'content production drafter',
    description: '원본 권리와 비용 경계를 확인한 뒤 영상·문서 초안을 만든다.',
    tools: ['video.plan', 'artifact.write', 'rights.check'],
    connection: 'local-runtime',
    routines: [{
      id: 'video-draft',
      name: '영상 초안 제작',
      trigger: {kind: 'manual', value: null},
      objective: '승인된 스크립트와 허용된 소재로 제작 계획과 로컬 초안을 제시한다.',
      inputRefs: ['research', 'artifacts', 'rights'],
      requiresOwnerApproval: true
    }]
  },
  {
    id: 'growth',
    name: 'Growth',
    role: 'growth experiment drafter',
    description: '광고·콘텐츠·수익화 아이디어를 가설과 측정 계획으로만 제안한다.',
    tools: ['market.observe', 'experiment.plan', 'evidence.record'],
    connection: 'local-runtime',
    routines: [{
      id: 'growth-experiment',
      name: '성장 실험 설계',
      trigger: {kind: 'manual', value: null},
      objective: '공개 신호를 바탕으로 하나의 검증 가능한 성장 실험과 중단 기준을 작성한다.',
      inputRefs: ['source', 'outcomes', 'rights'],
      requiresOwnerApproval: true
    }]
  },
  {
    id: 'guardian',
    name: 'Guardian',
    role: 'security and release gate',
    description: '비밀정보·권한·법적 위험·외부 부작용을 검사하고 승인 전 차단한다.',
    tools: ['security.review', 'rights.check', 'release.gate'],
    connection: 'local-runtime',
    routines: [{
      id: 'release-gate',
      name: '출시 전 안전 점검',
      trigger: {kind: 'event', value: 'artifact.ready'},
      objective: '비밀·권리·비용·외부 쓰기·복구 가능성을 확인하고 승인 상태를 남긴다.',
      inputRefs: ['artifact', 'evidence', 'policy'],
      requiresOwnerApproval: true
    }]
  }
];

function clone(value) {
  return structuredClone(value);
}

function currentTime(value) {
  if (value === undefined) return new Date().toISOString();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new PersistentBotError(400, 'invalid_time', 'A valid ISO timestamp is required.');
  }
  return value;
}

function text(value, field, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new PersistentBotError(400, 'invalid_text', field + ' must be a non-empty string of at most ' + maximum + ' characters.');
  }
  return value.trim();
}

function optionalText(value, field, maximum) {
  if (value === null || value === undefined) return null;
  return text(value, field, maximum);
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistentBotError(400, 'invalid_object', field + ' must be an object.');
  }
  return value;
}

function id(value, field, expression = BOT_ID_RE) {
  const result = text(value, field, 64);
  if (!expression.test(result)) {
    throw new PersistentBotError(400, 'invalid_id', field + ' has an invalid identifier.');
  }
  return result;
}

function list(value, field, maximum, itemMaximum = 200) {
  if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string' || !item.trim() || item.length > itemMaximum)) {
    throw new PersistentBotError(400, 'invalid_list', field + ' must be a bounded list of strings.');
  }
  return value.map(item => item.trim());
}

function unique(values, field) {
  if (new Set(values).size !== values.length) {
    throw new PersistentBotError(400, 'duplicate_id', field + ' contains a duplicate identifier.');
  }
}

function httpsUrl(value, field) {
  if (value === null || value === undefined) return null;
  const normalized = text(value, field, 2000);
  let parsed;
  try { parsed = new URL(normalized); } catch {
    throw new PersistentBotError(400, 'invalid_url', field + ' must be a valid HTTPS URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new PersistentBotError(400, 'unsafe_url', field + ' must use HTTPS without embedded credentials.');
  }
  return parsed.href;
}

function validateTrigger(trigger, field = 'trigger') {
  const value = object(trigger, field);
  if (!ROUTINE_KINDS.has(value.kind)) {
    throw new PersistentBotError(400, 'invalid_trigger', field + '.kind is unsupported.');
  }
  const triggerValue = value.value === null || value.value === undefined ? null : text(value.value, field + '.value', 160);
  if (value.kind !== 'manual' && !triggerValue) {
    throw new PersistentBotError(400, 'invalid_trigger', field + '.value is required for scheduled or event routines.');
  }
  return {kind: value.kind, value: triggerValue};
}

function validateMemory(memory, field = 'memory') {
  const value = object(memory, field);
  const kind = value.kind ?? 'source';
  const confidence = value.confidence ?? 'medium';
  const disposition = value.disposition ?? 'candidate';
  if (!MEMORY_KINDS.has(kind) || !CONFIDENCES.has(confidence) || !DISPOSITIONS.has(disposition)) {
    throw new PersistentBotError(400, 'invalid_memory', field + ' has an unsupported classification.');
  }
  const evidenceRefs = list(value.evidenceRefs ?? [], field + '.evidenceRefs', 12);
  const sourceUrl = httpsUrl(value.sourceUrl ?? null, field + '.sourceUrl');
  return {
    id: id(value.id, field + '.id', /^[a-f0-9-]{8,64}$/),
    kind,
    text: text(value.text, field + '.text', 16000),
    sourceUrl,
    sourceTitle: optionalText(value.sourceTitle ?? null, field + '.sourceTitle', 240),
    confidence,
    disposition,
    evidenceRefs,
    createdAt: currentTime(value.createdAt)
  };
}

function validateRoutine(routine, field = 'routine') {
  const value = object(routine, field);
  const status = value.status ?? 'not_wired';
  if (!['not_wired', 'ready', 'paused'].includes(status)) {
    throw new PersistentBotError(400, 'invalid_routine', field + '.status is unsupported.');
  }
  if (value.enabled !== false) {
    throw new PersistentBotError(409, 'routine_not_wired', 'Persistent routines remain disabled until an owner-approved executor is connected.');
  }
  const inputRefs = list(value.inputRefs ?? [], field + '.inputRefs', 20);
  if (value.requiresOwnerApproval !== true) {
    throw new PersistentBotError(409, 'owner_approval_required', 'Persistent routines require owner approval.');
  }
  return {
    id: id(value.id, field + '.id', ROUTINE_ID_RE),
    name: text(value.name, field + '.name', 160),
    trigger: validateTrigger(value.trigger, field + '.trigger'),
    objective: text(value.objective, field + '.objective', 2000),
    inputRefs,
    requiresOwnerApproval: true,
    enabled: false,
    status,
    createdAt: currentTime(value.createdAt),
    updatedAt: currentTime(value.updatedAt ?? value.createdAt),
    lastRunAt: value.lastRunAt === null || value.lastRunAt === undefined ? null : currentTime(value.lastRunAt)
  };
}

function validateBot(bot, field = 'bot') {
  const value = object(bot, field);
  const botId = id(value.id, field + '.id');
  const status = value.status ?? 'idle';
  if (!BOT_STATUSES.has(status)) throw new PersistentBotError(400, 'invalid_bot', field + '.status is unsupported.');
  const tools = list(value.tools, field + '.tools', 30, 100);
  const memory = (value.memory ?? []).map((item, index) => validateMemory(item, field + '.memory[' + index + ']'));
  const routines = (value.routines ?? []).map((item, index) => validateRoutine(item, field + '.routines[' + index + ']'));
  unique(memory.map(item => item.id), field + '.memory');
  unique(routines.map(item => item.id), field + '.routines');
  if (memory.length > MAX_MEMORY_PER_BOT) throw new PersistentBotError(400, 'memory_limit', field + '.memory exceeds the bounded limit.');
  return {
    id: botId,
    name: text(value.name, field + '.name', 120),
    role: text(value.role, field + '.role', 160),
    description: text(value.description, field + '.description', 2000),
    status,
    tools,
    connection: text(value.connection, field + '.connection', 120),
    externalProductConnected: value.externalProductConnected === true,
    memory,
    routines
  };
}

function validateHandoff(handoff, field = 'handoff') {
  const value = object(handoff, field);
  if (value.requiresOwnerApproval !== true || value.status !== 'awaiting_owner') {
    throw new PersistentBotError(409, 'handoff_not_approved', 'Persistent handoffs stay in awaiting_owner until the owner approves them in a separate reviewed flow.');
  }
  return {
    id: id(value.id, field + '.id', /^[a-f0-9-]{8,64}$/),
    fromBotId: id(value.fromBotId, field + '.fromBotId'),
    toBotId: id(value.toBotId, field + '.toBotId'),
    summary: text(value.summary, field + '.summary', 4000),
    evidenceRefs: list(value.evidenceRefs ?? [], field + '.evidenceRefs', 20),
    requiresOwnerApproval: true,
    status: 'awaiting_owner',
    createdAt: currentTime(value.createdAt)
  };
}

export function validatePersistentBots(registry) {
  const value = object(registry, 'persistentBots');
  if (value.schemaVersion !== PERSISTENT_BOT_SCHEMA_VERSION) {
    throw new PersistentBotError(400, 'invalid_schema', 'Unsupported persistent bot registry schema.');
  }
  const bots = (value.bots ?? []).map((item, index) => validateBot(item, 'persistentBots.bots[' + index + ']'));
  if (!bots.length || bots.length > MAX_BOTS) throw new PersistentBotError(400, 'invalid_bots', 'The persistent bot roster is empty or exceeds its bound.');
  unique(bots.map(item => item.id), 'persistentBots.bots');
  const botIds = new Set(bots.map(item => item.id));
  const handoffs = (value.handoffs ?? []).map((item, index) => validateHandoff(item, 'persistentBots.handoffs[' + index + ']'));
  if (handoffs.length > MAX_HANDOFFS) throw new PersistentBotError(400, 'handoff_limit', 'Persistent handoffs exceed the bounded limit.');
  unique(handoffs.map(item => item.id), 'persistentBots.handoffs');
  if (handoffs.some(item => !botIds.has(item.fromBotId) || !botIds.has(item.toBotId) || item.fromBotId === item.toBotId)) {
    throw new PersistentBotError(400, 'invalid_handoff', 'A handoff must connect two distinct registered bots.');
  }
  const events = value.events ?? [];
  if (!Array.isArray(events) || events.length > MAX_EVENTS || events.some(item => !item || typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.at !== 'string')) {
    throw new PersistentBotError(400, 'invalid_events', 'Persistent bot events are malformed or exceed their bound.');
  }
  return value;
}

export function initialPersistentBots(at = new Date().toISOString()) {
  const bots = BLUEPRINTS.map(blueprint => ({
    ...blueprint,
    status: 'idle',
    externalProductConnected: false,
    memory: [],
    routines: blueprint.routines.map(routine => ({
      ...routine,
      enabled: false,
      status: 'not_wired',
      createdAt: at,
      updatedAt: at,
      lastRunAt: null
    }))
  }));
  const registry = {
    schemaVersion: PERSISTENT_BOT_SCHEMA_VERSION,
    updatedAt: at,
    bots,
    handoffs: [],
    events: []
  };
  validatePersistentBots(registry);
  return registry;
}

function registryWithEvent(registry, event) {
  const next = clone(registry);
  next.events.unshift(event);
  next.events = next.events.slice(0, MAX_EVENTS);
  next.updatedAt = event.at;
  return next;
}

function botIndex(registry, botId) {
  const normalized = id(botId, 'botId');
  const index = registry.bots.findIndex(bot => bot.id === normalized);
  if (index < 0) throw new PersistentBotError(404, 'bot_not_found', 'Unknown persistent bot: ' + normalized);
  return index;
}

export function appendPersistentMemory(registry, botId, input, {at = new Date().toISOString()} = {}) {
  validatePersistentBots(registry);
  const value = object(input, 'memory');
  const allowed = new Set(['kind', 'text', 'sourceUrl', 'sourceTitle', 'confidence', 'disposition', 'evidenceRefs']);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new PersistentBotError(400, 'unknown_memory_field', 'Memory accepts only classified evidence fields.');
  }
  const index = botIndex(registry, botId);
  if (registry.bots[index].memory.length >= MAX_MEMORY_PER_BOT) {
    throw new PersistentBotError(409, 'memory_limit', 'This bot memory is full; review or archive entries before adding more.');
  }
  const memory = validateMemory({...value, id: randomUUID(), createdAt: at}, 'memory');
  const next = clone(registry);
  next.bots[index].memory.unshift(memory);
  return {
    registry: registryWithEvent(next, {
      id: randomUUID(),
      at: currentTime(at),
      text: 'Memory appended to ' + next.bots[index].id + ': ' + memory.disposition
    }),
    memory
  };
}

export function putPersistentRoutine(registry, botId, input, {at = new Date().toISOString()} = {}) {
  validatePersistentBots(registry);
  const value = object(input, 'routine');
  const allowed = new Set(['id', 'name', 'trigger', 'objective', 'inputRefs']);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new PersistentBotError(400, 'unknown_routine_field', 'Routine accepts only declarative, non-executing fields.');
  }
  const index = botIndex(registry, botId);
  const routineId = id(value.id, 'routine.id', ROUTINE_ID_RE);
  const existing = registry.bots[index].routines.find(item => item.id === routineId);
  const atValue = currentTime(at);
  const routine = validateRoutine({
    ...value,
    id: routineId,
    createdAt: existing?.createdAt ?? atValue,
    updatedAt: atValue,
    lastRunAt: existing?.lastRunAt ?? null,
    enabled: false,
    status: 'not_wired',
    requiresOwnerApproval: true
  }, 'routine');
  const next = clone(registry);
  next.bots[index].routines = next.bots[index].routines.filter(item => item.id !== routineId);
  next.bots[index].routines.unshift(routine);
  return {
    registry: registryWithEvent(next, {
      id: randomUUID(),
      at: atValue,
      text: 'Routine declared for ' + next.bots[index].id + ': ' + routine.id + ' (not_wired)'
    }),
    routine
  };
}

export function recordPersistentHandoff(registry, input, {at = new Date().toISOString()} = {}) {
  validatePersistentBots(registry);
  const value = object(input, 'handoff');
  const allowed = new Set(['fromBotId', 'toBotId', 'summary', 'evidenceRefs']);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new PersistentBotError(400, 'unknown_handoff_field', 'Handoff accepts only summary and evidence references.');
  }
  const fromIndex = botIndex(registry, value.fromBotId);
  const toIndex = botIndex(registry, value.toBotId);
  if (fromIndex === toIndex) throw new PersistentBotError(400, 'invalid_handoff', 'A bot cannot hand off to itself.');
  const atValue = currentTime(at);
  const handoff = validateHandoff({
    id: randomUUID(),
    fromBotId: registry.bots[fromIndex].id,
    toBotId: registry.bots[toIndex].id,
    summary: value.summary,
    evidenceRefs: value.evidenceRefs ?? [],
    requiresOwnerApproval: true,
    status: 'awaiting_owner',
    createdAt: atValue
  }, 'handoff');
  const next = clone(registry);
  next.handoffs.unshift(handoff);
  next.handoffs = next.handoffs.slice(0, MAX_HANDOFFS);
  return {
    registry: registryWithEvent(next, {
      id: randomUUID(),
      at: atValue,
      text: 'Handoff queued: ' + handoff.fromBotId + ' -> ' + handoff.toBotId + ' (awaiting_owner)'
    }),
    handoff
  };
}

export function publicPersistentBots(registry) {
  validatePersistentBots(registry);
  return clone(registry);
}

export function persistentBotOverview(registry) {
  validatePersistentBots(registry);
  return {
    schemaVersion: registry.schemaVersion,
    updatedAt: registry.updatedAt,
    bots: registry.bots.map(bot => ({
      id: bot.id,
      name: bot.name,
      role: bot.role,
      status: bot.status,
      connection: bot.connection,
      externalProductConnected: bot.externalProductConnected,
      memoryCount: bot.memory.length,
      routineCount: bot.routines.length,
      routines: bot.routines.map(routine => ({
        id: routine.id,
        name: routine.name,
        trigger: routine.trigger,
        enabled: routine.enabled,
        status: routine.status,
        requiresOwnerApproval: routine.requiresOwnerApproval,
        lastRunAt: routine.lastRunAt
      }))
    })),
    pendingHandoffs: registry.handoffs.filter(item => item.status === 'awaiting_owner').length,
    execution: {
      declarativeRoster: true,
      routineExecutor: false,
      externalBotProductConnected: false,
      browserAutomation: false,
      androidControl: false,
      paidVideoProvider: false,
      externalPublishing: false,
      paymentsOrTrading: false
    }
  };
}

export function persistentBotDocument(registry) {
  const overview = persistentBotOverview(registry);
  const lines = [
    '# BLACKHOLE 영속 봇 원장',
    '',
    '등록된 봇: ' + overview.bots.length + '개 · 승인 대기 인계: ' + overview.pendingHandoffs + '개',
    '상태: ' + (overview.execution.routineExecutor ? '루틴 실행 연결됨' : '루틴은 선언만 가능하며 아직 실행되지 않음'),
    '외부 Grok Bot 제품 연결: ' + (overview.execution.externalBotProductConnected ? '연결됨' : '미연결'),
    '',
    ...overview.bots.map(bot => '- ' + bot.name + ' (' + bot.id + ') · ' + bot.role + ' · 기억 ' + bot.memoryCount + '개 · 루틴 ' + bot.routineCount + '개'),
    '',
    '모든 인계는 owner approval 대기 상태이며, 외부 게시·결제·거래·기기 제어는 이 원장에서 실행하지 않습니다.'
  ];
  return lines.join('\n') + '\n';
}
