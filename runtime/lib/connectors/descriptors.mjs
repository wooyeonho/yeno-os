import fs from 'node:fs';

const locked = JSON.parse(fs.readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
  .packages['node_modules/quantum-circuit'];
const upstream = (name, repo = null) => ({name, repo, license: null, pinnedVersion: null,
  integrity: null, starsSeenAt: null, starsSeen: null});
const descriptor = (identity, auth, requires = []) => ({...identity, auth, requires,
  implemented: false, upstream: upstream(identity.title), authorizesDispatch: false});
const toggle = {shape: 'toggle', fields: ['enabled']};
const llm = {shape: 'llm-provider', fields: ['provider', 'model', 'apiKey']};
const token = {shape: 'token', fields: ['token']};
const triple = {shape: 'triple', fields: ['baseUrl', 'apiKey', 'officialEndpointConfirmed']};
const local = (id, kind, title) => descriptor({id, kind, title, mode: 'local'}, toggle);
const cloud = (id, kind, title, auth = llm, requires = []) => descriptor({id, kind, title, mode: 'cloud'}, auth, requires);

// Unknown upstream metadata stays null. A catalog row does not claim that its
// optional dependency or CP1 functional probe exists on the running machine.
const descriptors = [
  {...local('quantum-circuit', 'quantum', 'quantum-circuit'), implemented: true,
    upstream: {...upstream('quantum-circuit', 'https://github.com/quantastica/quantum-circuit'),
      license: locked.license, pinnedVersion: locked.version, integrity: locked.integrity}},
  {...descriptor({id: 'ollama', kind: 'inference', title: 'Ollama · 로컬 호환 추론', mode: 'local'},
    llm, ['YENO_LOCAL_BASE_URL', 'YENO_LOCAL_MODEL', 'YENO_AGENT_MODEL', 'YENO_AGENT_PROVIDER', 'YENO_AGENT_DAILY_CALL_LIMIT']), implemented: true},
  {...descriptor({id: 'obsidian', kind: 'vault', title: 'Obsidian Local REST API', mode: 'local'},
    {shape: 'api-key+ca', fields: ['enabled', 'apiKey', 'ca']},
    ['YENO_OBSIDIAN_REST_ENABLED', 'YENO_OBSIDIAN_REST_ENDPOINT', 'YENO_OBSIDIAN_REST_API_KEY', 'obsidian-local-rest-api.crt']), implemented: true},
  {...local('promptfoo', 'judge', 'promptfoo'), fallback: 'jev_v0_rules'},
  {...local('instructor-js', 'judge', 'instructor-js · Zod'), fallback: 'jev_v0_rules'},
  cloud('ibm-quantum', 'quantum', 'IBM Quantum', {shape: 'token', fields: ['token', 'instance']}),
  cloud('amazon-braket', 'quantum', 'Amazon Braket', {shape: 'service-key', fields: ['accessKeyId', 'secretAccessKey', 'region']}),
  {...local('ollama-embedding', 'embedding', 'Ollama 임베딩'), requires: ['YENO_LOCAL_EMBED_BASE_URL', 'YENO_LOCAL_EMBED_MODEL']},
  local('transformers-js', 'embedding', 'Transformers.js'),
  ...['openai', 'gemini', 'voyage'].map(id => cloud(`${id}-embedding`, 'embedding', `${id} 임베딩`)),
  local('node-llama-cpp', 'inference', 'node-llama-cpp'),
  local('onnxruntime-node', 'inference', 'ONNX Runtime'),
  ...['openai', 'gemini', 'nvidia', 'xai', 'anthropic', 'moonshot'].map(id =>
    cloud(id, 'inference', id, llm, [`YENO_${id.toUpperCase()}_MODEL`, `YENO_${id.toUpperCase()}_API_KEY`, 'YENO_AGENT_MODEL', 'YENO_AGENT_API_KEY'])),
  descriptor({id: 'searxng', kind: 'search', title: 'SearXNG', mode: 'process'}, toggle),
  cloud('brave-search', 'search', 'Brave Search', triple, ['YENO_SEARCH_BASE_URL', 'YENO_SEARCH_API_KEY', 'YENO_SEARCH_OFFICIAL_ENDPOINT_CONFIRMED']),
  cloud('tavily-search', 'search', 'Tavily Search', triple, ['YENO_SEARCH_BASE_URL', 'YENO_SEARCH_API_KEY', 'YENO_SEARCH_OFFICIAL_ENDPOINT_CONFIRMED']),
  {...descriptor({id: 'owner-analytics', kind: 'analytics', title: '소유자 분석 플랫폼 · 공급자 미선택', mode: 'cloud'},
    {shape:'owner-selection',fields:[]}), policy:{readOnly:true,providerSelected:false,credentials:'owner-only'}},
  {...descriptor({id: 'owner-publication', kind: 'publication', title: '소유자 게시 플랫폼 · 공급자 미선택', mode: 'cloud'},
    {shape:'owner-selection',fields:[]}), policy:{readOnly:true,providerSelected:false,credentials:'owner-only'}},
  {...descriptor({id: 'owner-revenue', kind: 'revenue', title: '소유자 정산 플랫폼 · 공급자 미선택', mode: 'cloud'},
    {shape:'owner-selection',fields:[]}), policy:{readOnly:true,providerSelected:false,credentials:'owner-only',payments:false,transfers:false}},
  descriptor({id: 'openclaw', kind: 'channel', title: 'OpenClaw', mode: 'process'}, token),
  {...descriptor({id: 'agent-reach', kind: 'scout', title: 'Agent Reach · 공개 자료 정찰 후보', mode: 'process'}, toggle),
    policy: {install: 'owner-pinned-version-and-hash', credentials: 'owner-only',
      firstScope: ['github', 'rss', 'public-web', 'youtube-captions'], socialPlatforms: 'separate-owner-approval',
      output: 'discovery-clue-only', verification: 'repository-evidence-required',
      selfInstall: false},
    upstream: {...upstream('Agent Reach', 'https://github.com/Panniantong/Agent-Reach'),
      license: 'MIT', pinnedVersion: 'a19a171fa980a0785849596492e0af4db800c82f', starsSeenAt: '2026-09-30T15:08:31.849Z', starsSeen: 86325}},
  cloud('telegram', 'channel', 'Telegram', token),
  local('browser-voice', 'voice', '브라우저 음성'),
  local('whisper-cpp', 'voice', 'whisper.cpp'),
  cloud('gemini-live', 'voice', 'Gemini Live'),
  descriptor({id: 'piper', kind: 'voice', title: 'Piper', mode: 'process'}, toggle),
  cloud('supabase', 'memory-sync', 'Supabase', {shape: 'service-key', fields: ['url', 'serviceKey']},
    ['YENO_MEMORY_SUPABASE_ENABLED', 'YENO_MEMORY_SUPABASE_URL', 'YENO_MEMORY_SUPABASE_SERVICE_KEY']),
];

export function connectorDescriptors() { return structuredClone(descriptors); }
