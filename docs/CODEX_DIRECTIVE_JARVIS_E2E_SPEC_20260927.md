# CODEX 지시서 — JARVIS 첫 화면 끝까지 완성 (완전판, 2026-09-27)

작성: Claude(Cowork). 이 문서는 "내가 직접 만든다면 이 순서로 이 코드를 넣는다"를 그대로 적은 것이다. 파일·행·함수·환경변수·문구·테스트 이름·스크린샷 파일명까지 적었다. 이 문서 밖의 판단이 필요하면 가장 보수적으로 하고 실행 기록에 "불명확: §번호"를 남긴다. 이 문서는 이전 `CODEX_DIRECTIVE_JARVIS_E2E_SPEC_20260927.md`를 **대체**한다.

**완료의 정의(한 문장):** 브라우저에서 `/jarvis`를 열고 "오늘 할 일 세 개 정리해줘"를 보내면, 원격 모델이 만든 결과가 60초 안에 화면에 뜨고, 상단 바에 어느 모델이 답했는지 보이며, 그 과정이 스크린샷 3장과 job JSON 1개로 남는다.

---

## 0. 절대 유지
- 소유자 승인 게이트(`waiting_owner`; `/api/web/pairing/approve`는 owner bearer 전용, `server.mjs` 1796~1803행), 외부 코드 검토 게이트, JEV `authorizesDispatch:false`.
- 보안 헤더(1755행): CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- bearer 검증(1576~1580행): HMAC-SHA256 파생 device token, `timingSafeEqual`.
- 웹 세션 쿠키(`web-pairing.mjs` 39행): `Path=/; HttpOnly; SameSite=Strict; Secure(https)` — **이미 있음. 손대지 말고 §7 테스트로만 고정.**
- `/api/commands` 속도 제한(`server.mjs` 178행 `createHankkiRateLimiter({limit:20})`, 2243~2245행 principal별 429) — **이미 있음. 손대지 말고 §7 테스트로만 고정.**
- 입력 상한 2000자(`jarvis.html` `maxlength="2000"`, 서버 `requiredText`).
- API 키 값·일부·길이·해시를 로그/리포트/기록/`/api/state`에 남기지 않는다. 있는지 여부(boolean)만.

## 0.1 이미 있는 것 (다시 만들지 말 것)
| 있음 | 위치 |
|---|---|
| 페어링 화면, 30일 유지 체크박스, 레거시 키 폼 | `jarvis.html` 13~24행, `web-client.mjs` |
| 오브 캔버스(호흡·halo·링 4개·별 86개·그림자 위성·planning 호·heartbeat 펄스·승인 점선 링·reduced-motion) | `jarvis.mjs` 205~285행 |
| 3초 폴링, `/api/state` + `/api/drives/status` | `jarvis.mjs` 129~176행, 292~297행 |
| 작업/대화 모드 토글(`/api/commands` vs `/api/voice chatOnly`) | `jarvis.mjs` 20~30행, 179~203행 |
| 409(모델 없음)→`목표 저장:` 보관 | `jarvis.mjs` 194~200행 |
| 소유자 서랍(의지/생명/권한, 자동운영·전체멈춤, 최근 작업 5개 일시정지/재개) | `jarvis.mjs` 62~127행 |
| provider 자동 선택(`YENO_AGENT_PROVIDER=auto` + `YENO_AGENT_PROVIDER_ORDER`) | `provider-config-engine.mjs` 72~88행 |
| 목표→job(`runQuest`, `provider:'auto'`) | `server.mjs` 798~812행 |

## 0.2 지금 빠진 것 (이 문서가 채우는 것)
1. provider 선택이 "설정 순서 중 첫 번째 준비된 것"이라 **작업 종류를 안 본다** → Builder가 로컬 3B로 가서 §66 1/5. (§2)
2. 화면이 "어느 provider·모델이 이 답을 했는지" 못 보여준다 — `publicJob`에 provider/model이 없거나 안 읽음. (§3)
3. 실패 사유가 영어 코드로 그대로 뜬다(`jarvis.mjs` 170행 `${j.error}`). (§4)
4. 상단 바 글자색 `--j-line #48535f`은 배경 대비 ≈3.0:1로 WCAG AA 미달. (§5)
5. `hint()`가 `innerHTML`(`jarvis.mjs` 40행). 지금은 고정 문구만 넣지만 구조적으로 위험. (§7)
6. 원격 provider로 돌린 실제 결과 스크린샷이 0장. (§9)
7. `YENO_AGENT_DAILY_CALL_LIMIT`가 정규식으로 **최대 20**(`provider-config-engine.mjs` 75행)이라 하루 20회 넘으면 409. 실측 중 걸릴 수 있음. (§1)

---

## 1. 환경 설정 (실측 전 1회, 키 값은 셸에서만)
```
YENO_AGENT_PROVIDER=auto
YENO_AGENT_PROVIDER_ORDER=nvidia,gemini,openai,anthropic,local
YENO_NVIDIA_MODEL=<현재 쓰는 NVIDIA 모델 ID>      YENO_NVIDIA_API_KEY=<셸에서만>
YENO_GEMINI_MODEL=<현재 쓰는 Gemini 모델 ID>       YENO_GEMINI_API_KEY=<셸에서만>
YENO_LOCAL_BASE_URL=http://localhost:11434/v1       YENO_LOCAL_MODEL=qwen2.5:3b
YENO_AGENT_DAILY_CALL_LIMIT=20
```
- 키가 있는 provider만 적는다. 없는 건 줄 자체를 빼면 `configured:false`로 자연 제외된다.
- 실측 당일 호출 상한 20 중 실측에 쓸 예산: A1~A3 합계 ≤ 6회. 초과하면 다음 날.
- `.env` 파일을 저장소에 만들지 않는다(현재 없음 확인됨). 셸 세션 환경변수로만.

---

## 2. 작업 종류별 provider 라우팅

### 2.1 새 파일 `runtime/lib/task-routing.mjs`
```js
// 작업 종류 → provider 우선순위. 값은 provider 이름 배열. 'local'이 없는 행은 로컬 금지.
export const TASK_ROUTES = Object.freeze({
  chat:            ['local','nvidia','gemini','openai','anthropic'],   // 짧은 대화(/api/voice chatOnly, 입력≤300자)
  shadowSummary:   ['local','nvidia','gemini','openai','anthropic'],   // shadow scout/researcher
  goal:            ['nvidia','gemini','openai','anthropic'],           // 목표: 실행(runQuest) — 로컬 금지
  shadowBuild:     ['nvidia','gemini','openai','anthropic'],           // shadow builder — 로컬 금지
  semanticVerify:  ['nvidia','gemini','openai','anthropic'],           // semanticVerifier — 로컬 금지
  research:        ['nvidia','gemini','openai','anthropic'],
  code:            ['nvidia','gemini','openai','anthropic'],
});
export const ROUTE_RETRY_LIMIT = 1;           // 1순위 실패 시 2순위로 1회만
export const ROUTE_TIMEOUT_MS = Object.freeze({remote:90000, local:180000});

// profiles: agentProfiles(env).primary.providers 형태 [{provider,model,configured,...}]
export function pickProvider(taskClass, profiles, {exclude=[]}={}) {
  const order = TASK_ROUTES[taskClass];
  if (!order) throw new Error(`unknown_task_class:${taskClass}`);
  for (const name of order) {
    if (exclude.includes(name)) continue;
    const entry = profiles.find(p => p.provider === name);
    if (entry?.configured) return name;
  }
  return null; // 호출자가 409 'NO_MODEL'로 변환
}
export function taskClassForJob(job) {
  if (job.voiceConversation) return 'chat';
  if (job.semanticVerifyRequest) return 'semanticVerify';
  if (job.researchRequest) return 'research';
  if (job.codeTask || job.repositoryTask) return 'code';
  const role = job.shadowAssignment?.role;
  if (role === 'builder') return 'shadowBuild';
  if (role === 'scout' || role === 'researcher') return 'shadowSummary';
  return 'goal';
}
```
### 2.2 연결 지점
- `server.mjs` 802행 `const config=agentConfigForProvider(env,quest.provider??'auto');` →
  ```js
  const wanted = quest.provider && quest.provider!=='auto' ? quest.provider : pickProvider('goal', agentSettings.providers);
  if(!wanted) throw new HttpError(409,'주 모델 연결이 필요합니다. 목표 저장: 명령으로 먼저 보관할 수 있습니다.',{code:'NO_MODEL'});
  const config=agentConfigForProvider(env,wanted);
  ```
- Shadow 임무 생성부(`shadow-army.mjs`에서 role별 job을 만드는 곳): `provider: pickProvider(role==='builder'?'shadowBuild':'shadowSummary', profiles)`. semanticVerifier job: `pickProvider('semanticVerify', …)`. `null`이면 임무 생성 자체를 409로 거부(로컬만 있을 때 builder를 로컬로 보내지 않는다).
- `agent-engine.mjs` 260행 `modelTurn` 호출 실패 시(`timeout`/`http_5xx`/`empty_model_response`만): `job.agentJournal.route ??= {attempts:[]}`에 `{provider,model,reason,at}` push. attempts 길이 < `ROUTE_RETRY_LIMIT+1`이면 `pickProvider(taskClass, profiles, {exclude: attempts.map(a=>a.provider)})`로 재선택 후 **같은 history**로 1회 재호출. 재호출 receipt에 `transport.fallbackFrom = 이전 provider`. 그 외 오류(401/400/context_limit)는 재시도 없음.
- 타임아웃: `modelTurn`의 `signal`을 `AbortSignal.any([signal, AbortSignal.timeout(local?180000:90000)])`로.
- `/api/state.agent.routing = {routes: TASK_ROUTES, retryLimit: 1, timeoutMs: ROUTE_TIMEOUT_MS}` 추가(208행 `state()`의 `agent:{…}` 안). 키 없음.

### 2.3 테스트 `runtime/test/task-routing.test.mjs` (새 파일)
1. `pickProvider('shadowBuild', [{provider:'local',configured:true}])` → `null` (로컬만 있으면 builder 불가).
2. `pickProvider('chat', [{provider:'local',configured:true},{provider:'nvidia',configured:true}])` → `'local'`.
3. `pickProvider('goal', 같은 배열)` → `'nvidia'`.
4. `pickProvider('goal', …, {exclude:['nvidia']})` → `'gemini'`가 configured면 `'gemini'`, 아니면 다음.
5. 합성 transport로 1순위가 `empty_model_response` → 2순위로 정확히 1회 재호출, `calls.length===2`, 두 번째 receipt `transport.fallbackFrom==='nvidia'`.
6. 1순위·2순위 모두 실패 → 3번째 호출 없음(`calls.length===2`), job `failed`, error `empty_model_response`.
7. `/api/state.agent.routing`을 `JSON.stringify` 후 `assertNoSecrets`.

---

## 3. 결과에 provider·모델 표시

### 3.1 서버
- `publicJob(job)`(server.mjs)에 `provider: job.agentJournal?.provider ?? job.provider ?? null`, `model: job.agentJournal?.model ?? null`, `route: job.agentJournal?.route ?? null` 추가. 키 없음.
- `/api/commands` 응답 `{job}`도 `publicJob`을 거치므로 자동 포함.

### 3.2 화면 (`jarvis.mjs`)
- 상단 바 `#model`: 현재 `${ag.provider} · ${ag.model}`(설정된 기본)을 표시. 이를 **마지막으로 말한 job의 provider·model**로 바꾼다:
  ```js
  const spoke = jobs.find(j => spokenJobs.has(j.id) && j.provider);   // 최근 순 배열이면 첫 항목
  $('model').textContent = spoke ? `${spoke.provider} · ${spoke.model}` : (ag.configured && ag.model ? `${ag.provider} · ${ag.model}` : '모델 연결 안 됨');
  ```
- `#doing`에 대기 중 표시: `생각하는 중…` 뒤에 ` · ${j.provider ?? '경로 선택 중'}`.
- `route.attempts.length>0`이면 `#doing`에 `· ${attempts[0].provider}에서 넘어옴` 1회 표시.

---

## 4. 실패 사유 한국어화 (`jarvis.mjs` 170행)
```js
const FAIL_KO = {
  timeout:'응답이 너무 늦었어', empty_model_response:'모델이 빈 답을 줬어', context_limit:'내용이 너무 길어',
  http_401:'모델 인증이 안 돼', http_403:'모델 접근이 막혀 있어', http_429:'모델 호출이 너무 많아', http_500:'모델 쪽에 문제가 생겼어',
  request_failed_or_stopped:'요청이 끊겼어', research_tools_disabled:'이 작업에선 도구를 쓸 수 없어', invalid_json:'모델 답 형식이 깨졌어',
  mission_call_limit:'호출 한도에 닿았어', dependency_failed:'앞 단계가 실패했어',
};
const failKo = code => { const key = String(code||'').replace(/^Agent:\s*/,'').replace(/^http_5\d\d$/,'http_500'); return FAIL_KO[key] || '알 수 없는 이유로 멈췄어'; };
// 170행: say(`그 일은 못 끝냈어. ${failKo(j.error||j.status)}. 숨기지 않을게.`);
```
- 원문 코드는 `#doing`에 mono로 `(${j.error})` 그대로 남긴다(투명성). 사용자 문장에는 영어 코드 없음.

---

## 5. UI — 수치와 문구

### 5.1 대비 (`jarvis.css` 3행 `--j-line:#48535f`)
- 배경 `#07090d` 위 `#48535f` ≈ **3.0:1** → 상단 바 텍스트·`.bar a`·`.dot.off`·placeholder에 쓰이는 색이 AA 미달.
- 수정: 텍스트 용도에는 `--j-muted #a9b1bb`(≈10:1). `--j-line`은 **테두리 전용**으로만 남긴다. 구체적으로 `.bar{color:var(--j-muted)}`, `.bar a{color:var(--j-muted)}`, `form.ask input::placeholder{color:var(--j-muted);opacity:.7}`.
- 산출: `docs/JARVIS_CONTRAST_20260927.md` — 표 열: 요소 / 전경 / 배경 / 비율(소수 2자리) / AA 판정. 최소 12행(bar 텍스트, bar 링크, speech line, doing, hint, gate, 버튼 텍스트, placeholder, 서랍 3칸, 서랍 설명, 오류 텍스트). 비율은 WCAG 상대휘도 공식으로 스크립트 계산(`scripts/contrast-check.mjs` 새로 만들고 `node scripts/contrast-check.mjs`가 표를 출력).

### 5.2 레이아웃
- `.app` `max-width:820px`, 패딩 `14px 20px 16px` → 데스크톱 좌우 40px(`--j-gutter`), `@media (max-width:480px)`에서 20px. 현재 변수만 있고 미사용이면 적용.
- 하단 입력창: `padding-bottom: max(16px, env(safe-area-inset-bottom))`.
- 400px 폭: `document.documentElement.scrollWidth === 400`, 오브·입력창·상단 바 전부 뷰포트 안.

### 5.3 오브 상태 (`jarvis.mjs draw()` — 현재 구현 위에 추가만)
| `core.activity` | 추가 표현 | 판정 |
|---|---|---|
| `idle` | 현재(호흡 4%) | 0s/0.9s 스크린샷 반지름 차 ≥ 3px |
| `planning` | 현재 호(R·0.87, 1.1rad) | 호 픽셀 존재 |
| `executing` | 링 R·1.06을 `t/300` 회전하는 1.2rad 호로 교체 | 호 존재 |
| `verifying` | 위 호 + 반대 방향 R·1.23 호 | 호 2개 |
| `waiting_owner` | 현재 점선 링(R·1.82 warn) + 코어 halo alpha 절반 | 점선 링 존재, 회전 0 |
| 오프라인 | 현재(`palette.offline`, 호흡 없음) | 두 스크린샷 동일 |
- reduced-motion: 현재 `still` 분기 유지. `executing/verifying` 호도 `still`이면 고정 각도.
- 7욕구: 색조만(`measuredDriveTint`). 호·숫자·범례 없음 유지.

### 5.4 문구 (정확한 문자열, `jarvis-scene-model.mjs composeFromCore` + `jarvis.mjs`)
| 상황 | 문자열 |
|---|---|
| 연결 전 | `연결을 확인하고 있어.` |
| 오프라인 | `본체와 끊겼어. 다시 붙으면 바로 말할게.` |
| idle | `조용한 박동. 그래도 나는 깨어 있어. 말 걸면 바로 움직일게.` |
| planning/executing + 목표 | `지금은 {욕구}이 제일 세. {목표} — 그걸 하고 있어.` |
| waiting_owner | `여기서부터는 되돌릴 수 없어. 마지막은 네가 정해줘.` |
| 모델 없음 | `말할 모델이 아직 안 붙어 있어. 이 PC의 BLACKHOLE 연결 창에서 모델을 고르면 바로 대답할게.` |
| 전송 직후 (`#doing`) | `{작업 제목} · 받았어` |
| 대기 (`#doing`) | `{작업 제목} · 생각하는 중… · {provider}` |
| 완료 | artifact 본문 ≤420자(markdown 기호 `#`,`**`,백틱 제거 후) |
| 실패 | `그 일은 못 끝냈어. {FAIL_KO}. 숨기지 않을게.` |
| 전체 멈춤 확인(서랍 인라인) | `정말 전부 멈출까? 진행 중 작업은 일시정지돼.` + 버튼 `멈춘다` / `아니` |
- 브라우저 `confirm()`/`alert()` 사용 금지(현재 없음, 유지).

### 5.5 서랍
- 열림/닫힘 140ms 슬라이드(`--j-motion-short`), ≤480px는 하단 시트.
- 의지/생명/권한: 값 없으면 `—`. "확인 중"은 첫 tick 전에만.
- 승인 카드: `되돌릴 수 없는 일 {n}건이 네 승인을 기다려.` + 가장 오래된 대기 job 제목 1줄 + 운영실 링크. **승인 버튼 없음.**
- 하단 한 줄: `이 기기 연결 D-{n}` — `/api/web/pairing` GET의 `expiresAt`로 계산, 3일 이하면 `--j-warn`.

---

## 6. 대화 모드 (`/api/voice chatOnly`)
- 서버에서 `chatOnly` job의 taskClass `chat` → `pickProvider('chat')` → 로컬 우선. 로컬 없으면 원격.
- 입력 300자 초과면 taskClass를 `goal`로 올리지 **않는다**(대화는 대화). 원격으로만 감.
- 응답 시간 목표: 로컬 3B ≤ 20초, 원격 ≤ 15초. 초과는 실패 아님, 리포트에 수치만.

---

## 7. 보안 고정·추가 (각각 red→green, 테스트 이름 고정)
`runtime/test/jarvis-security.test.mjs` (새 파일)
1. `commands rate limit: 21st request in a minute returns 429 with Retry-After` — 같은 web principal로 21회.
2. `web pairing cookie carries HttpOnly, SameSite=Strict, Path=/ and Secure over https`.
3. `state response contains no secret material` — `/api/state` 전체 문자열에 각 설정 키의 앞 6자·뒤 6자·전체가 없음(`assertNoSecrets` + 직접 `includes`).
4. `job journal and public job never expose Authorization` — 합성 provider 호출 후 `publicJob` JSON에 `Bearer` 문자열 없음.
5. `command text strips control characters and normalizes NFC` — `"목표: a\u0000b\u001fc"` → 서버가 저장한 `normalized`에 제어문자 없음, `"é"`(NFD) → NFC.
6. `security headers present on /jarvis and /api/state` — 5개 헤더 값 정확 비교.
7. `jarvis.html has no inline script or style` — 파일 문자열에 `<script>`(src 없는), `<style`, `onclick=`, `style="` 없음.
코드 변경:
- `jarvis.mjs` 40행 `hint()`: `innerHTML` → `textContent`. 코드 표시가 필요하면 `<code>` 대신 백틱 문자 그대로.
- `server.mjs` `requiredText`(또는 `/api/commands` 직전): `text.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'')` 후 길이 검사.

---

## 8. 작업 순서 (이 순서 그대로, 각 단계 끝에 관련 테스트 green + 실행 기록 1줄)
1. §7 테스트 7개 먼저 작성(1·2·6·7은 바로 green이어야 함 — 기존 보안 고정). 3·4·5·hint 수정으로 green.
2. §2 `task-routing.mjs` + 테스트 7개 + 연결 3곳 + `/api/state.agent.routing`.
3. §3 `publicJob` provider/model/route + 화면 `#model`·`#doing`.
4. §4 `FAIL_KO`.
5. §5.1 대비 수정 + `scripts/contrast-check.mjs` + 문서. §5.2 레이아웃. §5.4 문구. §5.3 오브 상태. §5.5 서랍.
6. §6 대화 모드 라우팅.
7. §9 실측.
8. `npm test` 전체 fail 0, 로그 SHA 기록. `node --check` 변경 JS. `git diff --check`.

---

## 9. 실측 (격리 core, 실제 원격 키, 폰 없음)
폴더 `build-artifacts/jarvis-e2e-20260927/`. 각 항목은 `report.json`에 `{id, ok, evidence:[파일명], durationMs}`.

| # | 절차 | 합격 | 증거 파일 |
|---|---|---|---|
| A1 | `/jarvis` 열고 작업 모드로 `오늘 할 일 세 개 정리해줘` 전송 | ≤60초 내 speech line에 결과, `#model`에 원격 provider·모델 이름, job `status:completed`, `provider`가 `TASK_ROUTES.goal[0]` 또는 fallback | `a1-before.png`, `a1-thinking.png`, `a1-result.png`, `a1-job.json` |
| A2 | 대화 모드로 `지금 몇 시야?` | ≤20초, 로컬 provider(로컬 설정 시) 또는 원격, 응답 표시 | `a2-result.png`, `a2-job.json` |
| A3 | 원격 키 전부 제거 + 로컬만 설정, 작업 모드로 A1 문장 | 409 `NO_MODEL`… 아니라 — **goal은 로컬 금지**이므로 409 + `목표로 보관했어` 문구 | `a3-result.png`, 응답 JSON |
| A4 | 모델 0개 설정 | 409 + 보관 문구, hint 문구 §5.4 | `a4-result.png` |
| A5 | 400×800 뷰포트 스크린샷(idle) | 가로 스크롤 0, 요소 전부 뷰포트 안 | `a5-mobile.png` + `scrollWidth` 값 |
| A6 | 1280×800 idle 0s/0.9s | 반지름 차 ≥3px | `a6-0.png`, `a6-1.png`, 측정값 |
| A7 | `prefers-reduced-motion: reduce` 에뮬레이션 0s/0.9s | 두 이미지 픽셀 동일 | `a7-0.png`, `a7-1.png`, diff=0 |
| A8 | `waiting_owner` 상태 강제(승인 대기 job 1개 만들기) | 점선 링 + 문구 + 서랍 승인 카드 n=1 | `a8-gate.png` |
| A9 | 실패 강제(합성 provider가 `empty_model_response`) | 화면 `그 일은 못 끝냈어. 모델이 빈 답을 줬어. 숨기지 않을게.`, `#doing`에 `(empty_model_response)` | `a9-fail.png` |
| A10 | `node scripts/contrast-check.mjs` | 전 행 ≥4.5 | 표 출력 저장 |
| A11 | 브라우저 콘솔 | CSP 위반 0, 오류 0 | `console.txt` |
| A12 | `npm test` | fail 0 | 로그 + SHA |
- 스크린샷은 Playwright(저장소에 있으면) 또는 기존 브라우저 캡처 경로. 각 PNG SHA-256을 `report.json`에.
- 원격 호출 예산: A1(1~2회)+A2(1회)+A9(0회, 합성) = ≤3회.

## 10. 완료 보고 형식 (실행 기록 §N)
- 첫 줄: `A1 ok/fail, provider=<이름>, model=<이름>, durationMs=<n>`.
- 변경 파일 목록, 새 테스트 파일 2개 이름, 테스트 수 증가분, 회귀 로그 SHA.
- **VERIFIED / RAN-UNVERIFIED / BLOCKED** 세 줄. "세계 최고"·"완성" 같은 단어 없이 숫자만.

## 11. Claude가 검증할 것
1. `TASK_ROUTES.shadowBuild`·`semanticVerify`·`goal`에 `'local'`이 없는가(코드+`/api/state.agent.routing` 응답).
2. `a1-result.png`에 원격 모델 이름이 보이고 `a1-job.json`의 `provider`와 같은가.
3. 재시도가 정확히 1회인가(테스트 5·6).
4. `contrast-check` 표를 독립 재계산해 일치하는가.
5. `jarvis-security.test.mjs` 7개가 실행 기록에 red→green 순서로 있는가(1·2·6·7은 처음부터 green이어야 정상).
6. 원격 호출 횟수가 예산(≤3) 안인가(`agentUsage`).
