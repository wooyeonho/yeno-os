// Run inside the existing core container. --inspect is read-only; --run performs
// the fixed owner-authorized acceptance set, including at most ONE Gemini call.
// Credentials stay in memory and Authorization headers to this same local core.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PREFIX = 'blackhole-studio-20260912-v1';
const PUBLIC_CORE = 'https://global-iris-gyeol-98386a17.koyeb.app/';
const sha = value => createHash('sha256').update(value).digest('hex');
const id = suffix => `${PREFIX}:${suffix}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
class CheckError extends Error {
  constructor(code, facts = {}) { super(code); this.code = code; this.facts = facts; }
}
const assert = (condition, code, facts) => { if (!condition) throw new CheckError(code, facts); };
const identities = items => ({ count: items.length, idsSha256: sha(items.map(item => item.id).sort().join(',')) });
const usage = value => Object.fromEntries(['date', 'attempts', 'settled', 'unknown', 'inputTokens', 'outputTokens'].filter(key => ['string', 'number'].includes(typeof value?.[key])).map(key => [key, value[key]]));
const collectionProof = state => Object.fromEntries(['jobs', 'projects', 'sources', 'memories', 'snapshots'].map(key => [key, identities(state[key])]));

export async function verifyProduction({ args = [], env = process.env, fetchImpl = fetch, write = line => console.log(line) } = {}) {
  assert(args.length <= 1 && args.every(arg => ['--run', '--inspect'].includes(arg)), 'use_only_inspect_or_run');
  const run = args[0] === '--run', port = Number(env.YENO_PORT || 8790), ownerToken = env.YENO_TOKEN;
  assert(Number.isInteger(port) && port > 0 && port < 65536, 'invalid_core_port');
  assert(typeof ownerToken === 'string' && ownerToken.length >= 16, 'existing_core_owner_credential_required');
  const base = `http://127.0.0.1:${port}`;
  let phase = 'inspect';
  const report = { checkId: PREFIX, startedAt: new Date().toISOString(), phases: {} };
  const emit = (kind, details) => write(`${kind} ${JSON.stringify(details)}`);

  async function http(route, body, { checkinToken, allowed = [], binary = false } = {}) {
    assert(typeof route === 'string' && route.startsWith('/api/') && !route.includes('#') && !route.includes('://'), 'invalid_local_api_route');
    let response;
    try {
      response = await fetchImpl(base + route, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: checkinToken ? `Checkin ${checkinToken}` : `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new CheckError('core_transport_uncertain_inspect_fixed_request_before_retry', { phase }); }
    if (allowed.includes(response.status)) { await response.arrayBuffer(); return { status: response.status }; }
    if (!response.ok) { await response.arrayBuffer(); throw new CheckError('core_request_rejected', { phase, httpStatus: response.status }); }
    let bytes;
    try { bytes = Buffer.from(await response.arrayBuffer()); } catch { throw new CheckError('core_response_incomplete', { phase }); }
    assert(bytes.length <= (binary ? 4 * 1024 * 1024 : 16 * 1024 * 1024), 'core_response_size_limit', { phase });
    if (binary) return { bytes, headers: response.headers };
    try { return JSON.parse(bytes.toString('utf8')); } catch { throw new CheckError('core_json_invalid', { phase }); }
  }
  async function lookup(requestId) {
    const result = await http(`/api/requests/${encodeURIComponent(requestId)}`, undefined, { allowed: [404] });
    return result.status === 404 ? null : result.request;
  }
  async function downloaded(route, expectedMime) {
    const result = await http(route, undefined, { binary: true });
    const sha256 = sha(result.bytes), mimeType = result.headers.get('content-type')?.split(';')[0];
    assert(sha256 === result.headers.get('x-content-sha256'), 'download_hash_mismatch', { phase });
    if (expectedMime) assert(mimeType === expectedMime, 'download_mime_mismatch', { phase });
    return { ...result, proof: { bytes: result.bytes.length, sha256, mimeType } };
  }
  async function artifacts(job) {
    const result = [];
    for (const item of job.artifacts ?? []) {
      assert(uuid(item.id), 'invalid_artifact_id', { phase, jobId: job.id });
      const file = await downloaded(`/api/artifacts/${item.id}`);
      result.push({ ...file, proof: { artifactId: item.id, ...file.proof } });
    }
    assert(result.length > 0, 'completed_job_without_artifact', { phase, jobId: job.id });
    return result;
  }
  async function finishedJob(jobId, timeoutMs = 120_000) {
    assert(uuid(jobId), 'invalid_job_identity', { phase });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await http('/api/state'), job = current.jobs.find(item => item.id === jobId);
      assert(job, 'saved_job_missing', { phase, jobId });
      if (job.status === 'completed') return job;
      if (['failed', 'paused', 'cancelled'].includes(job.status)) throw new CheckError('existing_job_requires_review_no_new_request', { phase, jobId, status: job.status, unknownCalls: job.agent?.unknownCalls ?? 0 });
      if (Date.now() >= deadline) throw new CheckError('saved_job_still_running_no_duplicate', { phase, jobId, status: job.status });
      await sleep(1000);
    }
  }
  async function fixedJob(route, body, { paid = false, timeoutMs } = {}) {
    const previous = await lookup(body.requestId);
    let jobId;
    if (previous) {
      assert(previous.reference?.collection === 'jobs' && uuid(previous.reference.id), 'accepted_request_missing_job_reference', { phase });
      jobId = previous.reference.id;
    } else {
      if (paid) {
        const current = await http('/api/state');
        assert(!current.emergencyStop && current.agent?.configured && current.agent.provider === 'gemini', 'gemini_primary_required_no_provider_substitution', { phase });
        assert(current.agent.dailyCallLimit >= 20 && current.agent.usage.attempts < current.agent.dailyCallLimit, 'approved_daily_limit_20_and_remaining_call_required', { phase });
      }
      const response = await http(route, body); jobId = response.job?.id;
      emit('BLACKHOLE_PRODUCTION_PHASE', { phase, status: 'accepted', jobId });
    }
    const job = await finishedJob(jobId, timeoutMs);
    if (paid) assert(job.agent?.provider === 'gemini' && job.agent.calls === 1 && job.agent.unknownCalls === 0 && job.callLimit === 1, 'gemini_one_call_contract_mismatch', { phase, jobId });
    const files = await artifacts(job);
    const replay = await http(route, body);
    assert(replay.job?.id === jobId, 'replayed_request_changed_job', { phase, jobId });
    return { job, files, reused: Boolean(previous) };
  }
  async function studioRecord(suffix, body, collection, matches) {
    const requestId = id(suffix), previous = await lookup(requestId);
    if (!previous) await http('/api/studio', { requestId, ...body });
    const studio = await http('/api/studio'), found = studio[collection].filter(matches);
    assert(found.length === 1, 'verification_record_identity_not_unique', { phase, collection });
    return found[0];
  }
  const completed = details => { report.phases[phase] = details; emit('BLACKHOLE_PRODUCTION_PHASE', { phase, status: 'verified', ...details }); };

  try {
    const before = await http('/api/state'), capabilityView = await http('/api/capabilities'), studioBefore = await http('/api/studio');
    const beforeIds = collectionProof(before);
    const inspect = { checkId: PREFIX, checkedAt: new Date().toISOString(), mode: run ? 'authorized_acceptance' : 'read_only', revision: before.revision, globalStop: before.emergencyStop, active: before.jobs.filter(job => ['queued', 'running'].includes(job.status)).length, collections: beforeIds, studio: Object.fromEntries(['places', 'contacts', 'checkins', 'series', 'chapters'].map(key => [key, identities(studioBefore[key])])), provider: before.agent.provider, model: before.agent.model, dailyCallLimit: before.agent.dailyCallLimit, usage: usage(before.agent.usage), capabilities: capabilityView.capabilities.map(item => ({ id: item.id, status: item.status, completedOutputs: item.completedOutputs })), storage: Object.fromEntries(['maxBytes', 'estimatedBytes', 'remainingBytes', 'canCreateVideo', 'canCreateForAi'].map(key => [key, capabilityView.storage?.[key]])) };
    emit('BLACKHOLE_PRODUCTION_INSPECT', inspect);
    if (!run) return inspect;
    assert(!before.emergencyStop, 'global_stop_is_active_no_settings_changed');
    assert(capabilityView.capabilities.some(item => item.id === 'video' && item.status === 'available'), 'video_runtime_not_available');
    for (const active of before.jobs.filter(job => ['running', 'queued'].includes(job.status))) {
      let owned = false;
      for (const suffix of ['video', 'forai', 'world', 'novel:generate']) if ((await lookup(id(suffix)))?.reference?.id === active.id) owned = true;
      assert(owned, 'unrelated_active_job_wait_for_idle_core', { jobId: active.id });
    }

    phase = 'video';
    const video = await fixedJob('/api/production/run', { requestId: id('video'), kind: 'video', input: { title: '블랙홀 · 실제 영상 제작', scenes: [{ heading: '휴대폰에서 맡긴 문구를\n실제 영상으로', body: '한글 장면을 세로 MP4로 저장합니다.\n이 영상은 무음입니다.', seconds: 6 }, { heading: '기록과 결과를\n다시 열어 확인하세요', body: '원본 텍스트 카드 · 720 × 1280\n음성·음악·자동 게시 없음', seconds: 6 }] } }, { timeoutMs: 180_000 });
    const mp4 = video.files.find(file => file.proof.mimeType === 'video/mp4');
    assert(mp4 && mp4.bytes.subarray(4, 8).toString('ascii') === 'ftyp', 'mp4_container_missing');
    completed({ jobId: video.job.id, reused: video.reused, durationSeconds: 12, audio: false, artifact: mp4.proof, replaySameJob: true });

    phase = 'forai';
    const audit = await fixedJob('/api/production/run', { requestId: id('forai'), kind: 'forai', input: { mode: 'url', url: PUBLIC_CORE, profile: { name: 'BLACKHOLE', description: '소유자가 목표와 기록, 작업 결과를 관리하는 개인 작업 도구', siteUrl: PUBLIC_CORE } } });
    const jsonFile = audit.files.find(file => file.proof.mimeType === 'application/json');
    assert(jsonFile, 'forai_evidence_json_missing');
    let evidence; try { evidence = JSON.parse(jsonFile.bytes.toString('utf8')); } catch { throw new CheckError('forai_evidence_invalid'); }
    assert(evidence.mode === 'url' && evidence.source?.url === PUBLIC_CORE && evidence.source.readMethod === 'dns_pinned_https' && evidence.source.status === 200, 'forai_public_url_evidence_mismatch');
    completed({ jobId: audit.job.id, reused: audit.reused, sourceUrl: PUBLIC_CORE, sourceBytes: evidence.source.bytes, sourceSha256: evidence.source.sha256, sourceReadMethod: evidence.source.readMethod, artifacts: audit.files.map(file => file.proof), replaySameJob: true, modelCalls: 0 });

    phase = 'world';
    const world = await fixedJob('/api/commands', { requestId: id('world'), text: '세계 현황' });
    const worldView = await http('/api/world'), snapshot = worldView.snapshot;
    assert(worldView.latestJobId === world.job.id && snapshot, 'world_snapshot_identity_mismatch');
    completed({ jobId: world.job.id, reused: world.reused, partial: Boolean(worldView.partial), earthquakeCount: snapshot.events.length, earthquakeSourceSha256: snapshot.sha256, hazardsStatus: snapshot.hazards?.status ?? 'absent', hazardCount: snapshot.hazards?.events.length ?? 0, hazardSourceSha256: snapshot.hazards?.sha256 ?? null, artifacts: world.files.map(file => file.proof), replaySameJob: true, modelCalls: 0 });

    phase = 'yeogie';
    const placeNote = `자동 인수검사용 예시입니다. 실제 방문이나 위치 기록이 아닙니다. ${PREFIX}`;
    const place = await studioRecord('place', { action: 'place.create', title: '블랙홀 운영 검증용 장소 메모', note: placeNote, tags: ['운영검증', '합성예시'] }, 'places', record => record.note === placeNote);
    const placesExport = await downloaded('/api/studio/export?kind=places', 'application/json');
    const exportedPlaces = JSON.parse(placesExport.bytes.toString('utf8'));
    assert(exportedPlaces.places.some(record => record.id === place.id && record.note === placeNote), 'place_export_missing_record');
    completed({ placeId: place.id, syntheticExample: true, actualVisitClaimed: false, export: placesExport.proof });

    phase = 'hankki';
    const consentNote = `실제 사람이 아닌 소유자 인수검사용 합성 기록; 외부 발송 없음. ${PREFIX}`;
    const contact = await studioRecord('contact', { action: 'contact.create', name: '운영 검증용 가상 수신자', relationship: '합성 자체 인수검사', consent: 'granted', consentNote }, 'contacts', record => record.consentNote === consentNote);
    const checkinNote = `실제 식사·안부에 관한 기록이 아닌 합성 왕복 검증. ${PREFIX}`;
    const checkin = await studioRecord('checkin', { action: 'checkin.create', contactId: contact.id, dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), meal: 'other', note: checkinNote }, 'checkins', record => record.contactId === contact.id && record.note === checkinNote);
    let finalCheckin = checkin;
    if (checkin.status === 'answered' && checkin.recordedBy === 'recipient' && checkin.invitation?.status === 'revoked') {
      completed({ contactId: contact.id, checkinId: checkin.id, recipientRoundTrip: true, answer: checkin.answer, revoked: true, reused: true, synthetic: true, externalMessageSent: false });
    } else {
      let scopedToken;
      try {
        const issued = await http('/api/hankki/invite', { requestId: id('invite'), checkinId: checkin.id, expectedRevision: 1 });
        const responseUrl = new URL(issued.responseUrl), fragment = new URLSearchParams(responseUrl.hash.slice(1));
        scopedToken = fragment.get('token');
        assert(responseUrl.pathname === '/hankki/answer' && !responseUrl.search && fragment.get('id') === checkin.id && /^v1\.[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/.test(scopedToken ?? ''), 'scoped_response_link_invalid');
        const recipientRoute = `/api/hankki/checkins/${checkin.id}`;
        const recipient = await http(recipientRoute, undefined, { checkinToken: scopedToken });
        assert(Object.keys(recipient.checkin).sort().join(',') === 'answer,answeredAt,checkinId,dueAt,meal,status', 'recipient_view_exposed_owner_fields');
        const answerBody = { requestId: id('recipient-answer'), answer: 'ate' };
        const answered = await http(recipientRoute, answerBody, { checkinToken: scopedToken });
        const replay = await http(recipientRoute, answerBody, { checkinToken: scopedToken });
        assert(answered.checkin.answer === 'ate' && JSON.stringify(answered.checkin) === JSON.stringify(replay.checkin), 'recipient_replay_mismatch');
        finalCheckin = (await http('/api/studio')).checkins.find(record => record.id === checkin.id);
        assert(finalCheckin.status === 'answered' && finalCheckin.recordedBy === 'recipient', 'recipient_response_not_durable');
        await http('/api/hankki/revoke', { requestId: id('revoke'), checkinId: checkin.id, expectedRevision: finalCheckin.revision });
        const rejected = await http(recipientRoute, undefined, { checkinToken: scopedToken, allowed: [404] });
        assert(rejected.status === 404, 'revoked_link_still_accessible');
        finalCheckin = (await http('/api/studio')).checkins.find(record => record.id === checkin.id);
        assert(finalCheckin.invitation?.status === 'revoked', 'link_revocation_not_durable');
        completed({ contactId: contact.id, checkinId: checkin.id, recipientRoundTrip: true, answer: finalCheckin.answer, revoked: true, reused: false, synthetic: true, externalMessageSent: false });
      } finally {
        // Close any successfully issued synthetic link even if a later check failed.
        const current = (await http('/api/studio')).checkins.find(record => record.id === checkin.id);
        if (current?.invitation?.status === 'active') await http('/api/hankki/revoke', { requestId: id('revoke-finally'), checkinId: checkin.id, expectedRevision: current.revision });
        scopedToken = undefined;
      }
    }

    phase = 'novel';
    const premise = `운영 인수검사용 독립 합성 작품. 기존 작품이나 정식 연재를 대체하지 않는다. ${PREFIX}\n낡은 기록실에서 사라진 이름을 찾는 서윤의 짧은 이야기.`;
    const series = await studioRecord('series', { action: 'series.create', title: '블랙홀 운영 검증용 단편', genre: '기록 미스터리', premise, characters: '서윤: 잃어버린 이름을 찾는 기록 보관자', outline: '기록실의 불이 켜지고 서윤이 이름 하나를 되찾는 완결 장면. 실제 운영 성과나 실존 인물을 묘사하지 않는다.' }, 'series', record => record.premise === premise);
    const generated = await fixedJob('/api/studio/generate', { requestId: id('novel:generate'), seriesId: series.id, instructions: '한국어 800~1,200자의 완결 단편 장면을 지금 작성하세요. 제목은 기록이 켜지는 밤입니다. 인물의 행동과 대사를 포함하고 마지막에 서윤이 이름 하나를 되찾도록 끝내세요. 원고 본문 앞뒤에 지정된 BLACKHOLE_CHAPTER_START / BLACKHOLE_CHAPTER_END HTML 주석 표식을 각각 정확히 한 번 넣으세요. 도구·검색을 호출하지 마세요. 이 이야기는 운영 인수검사용 허구입니다.' }, { paid: true, timeoutMs: 120_000 });
    const importRequest = { requestId: id('novel:import'), seriesId: series.id, jobId: generated.job.id, number: 1, title: '기록이 켜지는 밤' };
    const imported = await http('/api/studio/import', importRequest), importReplay = await http('/api/studio/import', importRequest);
    assert(imported.result?.id === importReplay.result?.id, 'chapter_import_replay_mismatch');
    const chapter = (await http('/api/studio')).chapters.find(record => record.id === imported.result.id);
    assert(chapter?.seriesId === series.id && chapter.number === 1 && chapter.content?.trim(), 'imported_chapter_missing');
    const chapterExport = await downloaded(`/api/studio/export?kind=chapter&id=${chapter.id}`, 'text/markdown');
    assert(chapterExport.bytes.toString('utf8').includes(chapter.content), 'chapter_export_content_mismatch');
    completed({ seriesId: series.id, chapterId: chapter.id, jobId: generated.job.id, reused: generated.reused, provider: generated.job.agent.provider, model: generated.job.agent.model, modelCalls: generated.job.agent.calls, unknownCalls: generated.job.agent.unknownCalls, contentCharacters: [...chapter.content].length, contentSha256: sha(chapter.content), artifact: chapterExport.proof, replaySameJob: true, replaySameChapter: true, externalPublishing: false });

    phase = 'preservation';
    const after = await http('/api/state'), studioAfter = await http('/api/studio'), afterIds = collectionProof(after);
    assert(['projects', 'sources', 'memories', 'snapshots'].every(key => afterIds[key].idsSha256 === beforeIds[key].idsSha256) && before.jobs.every(job => after.jobs.some(current => current.id === job.id)), 'existing_collection_identity_changed');
    assert(JSON.stringify(after.modules) === JSON.stringify(before.modules) && after.emergencyStop === before.emergencyStop && after.concurrency === before.concurrency && after.agent.dailyCallLimit === before.agent.dailyCallLimit && after.agent.automaticReviews === before.agent.automaticReviews, 'runtime_controls_changed');
    for (const key of ['places', 'contacts', 'checkins', 'series', 'chapters']) for (const original of studioBefore[key]) {
      if (JSON.stringify(original).includes(PREFIX)) continue;
      const current = studioAfter[key].find(record => record.id === original.id);
      const stable = record => { const { displayStatus, ...persisted } = record ?? {}; return persisted; };
      assert(current && JSON.stringify(stable(current)) === JSON.stringify(stable(original)), 'existing_studio_record_changed', { collection: key, recordId: original.id });
    }
    completed({ existingDataPreserved: true, controlsPreserved: true, collections: afterIds, usage: usage(after.agent.usage) });
    report.status = 'verified'; report.finishedAt = new Date().toISOString(); report.actualModelCallsThisRun = report.phases.novel.reused ? 0 : 1;
    emit('BLACKHOLE_PRODUCTION_RESULT', report);
    return report;
  } catch (error) {
    const blocked = { checkId: PREFIX, phase, status: 'blocked', code: error instanceof CheckError ? error.code : 'unexpected_verification_error', ...(error instanceof CheckError ? error.facts : {}), verifiedPhases: Object.keys(report.phases), checkedAt: new Date().toISOString() };
    emit('BLACKHOLE_PRODUCTION_BLOCKED', blocked);
    return blocked;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await verifyProduction({ args: process.argv.slice(2) }); if (result.status === 'blocked') process.exitCode = 1; }
  catch { console.error('BLACKHOLE_PRODUCTION_BLOCKED {"status":"blocked","code":"invalid_arguments_or_missing_core_configuration"}'); process.exitCode = 1; }
}
