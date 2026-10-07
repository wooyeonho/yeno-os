// Verify the existing core's native scheduler. --enable uses one durable control
// request; all task selection and execution must then happen inside the core.
// The existing owner credential stays in memory and is never part of the proof.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateResearchBundle, researchCitationIds, RESEARCH_TRACKS } from '../runtime/lib/research.mjs';
import { validateWorldSnapshot } from '../runtime/lib/world.mjs';

const ORIGIN = 'https://global-iris-gyeol-98386a17.koyeb.app';
const CHECK_ID = 'blackhole-autopilot-20260912-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (ok, code) => { if (!ok) throw new Error(code); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const counts = state => ({ jobs: state.jobs.length, projects: state.projects.length, sources: state.sources.length, aiAttempts: state.agent.usage.attempts, globalLimit: state.agent.dailyCallLimit });
const publicStatus = value => ({ enabled: value.enabled, dailyAiLimit: value.dailyAiLimit, aiUsedToday: value.aiUsedToday, globalLimit: value.globalLimit, globalUsedToday: value.globalUsedToday, activeJobId: value.activeJobId, nextAt: value.nextAt });

export async function verifyAutopilot({ env = process.env, fetchImpl = fetch, enable = false, write = console.log, timeoutMs = 180_000 } = {}) {
  assert(typeof env.YENO_TOKEN === 'string' && env.YENO_TOKEN.length >= 16, 'existing_owner_key_required');
  const headers = { Authorization: `Bearer ${env.YENO_TOKEN}` };
  async function http(route, body) {
    const response = await fetchImpl(ORIGIN + route, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(response.ok, `http_${response.status}_${route}`);
    return { bytes, response, json: () => JSON.parse(bytes) };
  }
  const before = (await http('/api/state')).json(), initial = (await http('/api/autopilot')).json();
  const summary = { at: new Date().toISOString(), checkId: CHECK_ID, origin: ORIGIN, mode: enable ? 'enable_existing_native_scheduler' : 'read_only', before: counts(before), autopilotBefore: publicStatus(initial) };
  if (!enable) {
    summary.recentJobs = before.jobs.filter(job => job.autopilot).slice(-12).map(job => ({ id: job.id, kind: job.autopilot.kind, status: job.status, parentJobId: job.autopilot.parentJobId ?? null, artifacts: job.artifacts.map(file => ({ id: file.id, name: file.name })) }));
    write(`AUTOPILOT_INSPECTED ${JSON.stringify(summary)}`); return summary;
  }
  assert(before.emergencyStop === false, 'global_stop_active');
  assert(before.agent.dailyCallLimit >= 4, 'existing_global_budget_insufficient');
  // This is the only mutation made by the verifier. Retrying this script reuses
  // the same identity and cannot silently turn a subsequently stopped loop on.
  await http('/api/autopilot', { requestId: `${CHECK_ID}:enable`, enabled: true, dailyAiLimit: 4 });
  let state, overview, world, research, forai, video;
  const deadline = Date.now() + Math.min(180_000, Math.max(1_000, timeoutMs));
  while (Date.now() < deadline) {
    state = (await http('/api/state')).json(); overview = (await http('/api/autopilot')).json();
    const jobs = state.jobs.filter(job => job.autopilot);
    assert(jobs.filter(job => ['queued', 'running'].includes(job.status)).length <= 1, 'multiple_active_autopilot_jobs');
    world = jobs.find(job => job.autopilot.kind === 'world' && job.status === 'completed');
    research = jobs.find(job => job.autopilot.kind === 'research' && job.status === 'completed' && jobs.some(next => next.autopilot.kind === 'video' && next.autopilot.parentJobId === job.id && next.status === 'completed'));
    video = research && jobs.find(job => job.autopilot.kind === 'video' && job.autopilot.parentJobId === research.id && job.status === 'completed');
    forai = research && jobs.find(job => job.autopilot.kind === 'forai' && job.autopilot.parentJobId === research.id && job.status === 'completed');
    if (world && research && forai && video) break;
    assert(overview.enabled, 'autopilot_disabled_before_completion');
    await delay(1_000);
  }
  assert(world && research && forai && video, 'native_world_research_forai_video_chain_incomplete');
  assert(research.agent?.calls === 1 && research.agent.unknownCalls === 0, 'research_requires_one_settled_model_call');
  assert(RESEARCH_TRACKS.some(track => track.projectId === research.projectId && track.code === research.autopilot.trackCode), 'research_canonical_project_mismatch');
  const fileProof = async file => {
    assert(file?.id, 'artifact_reference_missing');
    const result = await http(`/api/artifacts/${file.id}`), sha256 = hash(result.bytes);
    assert(sha256 === result.response.headers.get('x-content-sha256'), 'download_hash_mismatch');
    return { result, proof: { id: file.id, name: file.name, bytes: result.bytes.length, sha256 } };
  };
  const worldFiles = [];
  for (const file of world.artifacts) worldFiles.push((await fileProof(file)).proof);
  assert(worldFiles.length > 0, 'world_result_missing');
  const worldOverview = (await http('/api/world')).json();
  assert(worldOverview.latestJobId === world.id, 'world_snapshot_job_mismatch');
  validateWorldSnapshot(worldOverview.snapshot);
  assert(worldOverview.snapshot.format === 2, 'combined_world_sources_missing');
  const worldSources = { checkedAt: worldOverview.snapshot.checkedAt, usgs: { status: worldOverview.snapshot.earthquakeError ? 'error' : 'ok', sha256: worldOverview.snapshot.sha256, sourceCount: worldOverview.snapshot.sourceCount }, nasa: { status: worldOverview.snapshot.hazards.status, sha256: worldOverview.snapshot.hazards.sha256, sourceCount: worldOverview.snapshot.hazards.sourceCount } };
  const evidence = await fileProof(research.artifacts.find(file => file.id === research.researchEvidenceId));
  const bundle = evidence.result.json(); validateResearchBundle(bundle);
  assert(bundle.sources.length > 0 && bundle.projectId === research.projectId, 'research_evidence_scope_invalid');
  const raw = [];
  for (const search of bundle.searches.filter(search => search.status === 'ok')) {
    const file = await fileProof(research.artifacts.find(item => item.name === search.rawFileName));
    assert(file.proof.sha256 === search.rawSha256, 'research_raw_hash_mismatch');
    raw.push({ provider: search.provider, ...file.proof });
  }
  const answer = await fileProof(research.artifacts.find(file => file.name.startsWith('research-answer-')));
  const manuscript = answer.result.bytes.toString('utf8');
  assert(manuscript.includes('검증 전 AI 초안'), 'research_uncertainty_label_missing');
  const citations = researchCitationIds(manuscript);
  assert(citations.length > 0 && citations.every(id => bundle.sources.some(source => source.citationId === id)), 'research_citations_invalid');
  const movie = await fileProof(video.artifacts.find(file => file.name.endsWith('.mp4')));
  const foraiFiles = [];
  for (const file of forai.artifacts) {
    const checked = await fileProof(file); foraiFiles.push(checked.proof);
    if (file.name.startsWith('forai-evidence-')) {
      const source = checked.result.json().source;
      assert(source.readMethod === 'core_generated_research' && source.generatedFrom?.jobId === research.id && source.generatedFrom.answerSha256 === answer.proof.sha256, 'generated_research_page_provenance_missing');
    }
  }
  assert(foraiFiles.some(file => file.name.endsWith('.json')) && foraiFiles.some(file => file.name.endsWith('.md')), 'forai_evidence_or_report_missing');
  assert(movie.result.response.headers.get('content-type')?.startsWith('video/mp4'), 'video_content_type_invalid');
  assert(movie.result.bytes.subarray(4, 8).toString('ascii') === 'ftyp' && movie.result.bytes.length > 1_024, 'video_container_missing');
  const after = (await http('/api/state')).json(), final = (await http('/api/autopilot')).json();
  for (const key of ['projects', 'sources', 'memories', 'snapshots']) assert(before[key].every(old => after[key].some(next => next.id === old.id)), `lost_${key}`);
  assert(after.agent.dailyCallLimit === before.agent.dailyCallLimit && after.agent.automaticReviews === before.agent.automaticReviews && after.emergencyStop === before.emergencyStop, 'unrelated_controls_changed');
  assert(final.enabled && final.dailyAiLimit === 4 && final.aiUsedToday <= 4 && after.agent.usage.attempts <= after.agent.dailyCallLimit, 'scheduler_or_global_budget_invalid');
  Object.assign(summary, { world: { jobId: world.id, files: worldFiles, sources: worldSources }, research: { jobId: research.id, trackCode: research.autopilot.trackCode, projectId: research.projectId, provider: research.agent.provider, model: research.agent.model, calls: research.agent.calls, unknownCalls: research.agent.unknownCalls, sourceCount: bundle.sources.length, raw, evidence: evidence.proof, answer: answer.proof }, forai: { jobId: forai.id, parentJobId: forai.autopilot.parentJobId, files: foraiFiles, additionalModelCalls: forai.agent?.calls ?? 0 }, video: { jobId: video.id, parentJobId: video.autopilot.parentJobId, file: movie.proof, additionalModelCalls: video.agent?.calls ?? 0 }, after: counts(after), autopilotAfter: publicStatus(final), newModelCalls: after.agent.usage.attempts - before.agent.usage.attempts, checks: ['only one durable scheduler control request submitted', 'core selected and completed world research private-page audit and derived video without task submissions', 'at most one autonomous task active during polling', 'evidence and generated files downloaded with matching hashes', 'existing canonical records and global model limit preserved'], claimStatus: 'native_bounded_operations_research_draft_not_scientific_solution' });
  write(`AUTOPILOT_VERIFIED ${JSON.stringify(summary)}`); return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) verifyAutopilot({ enable: process.argv.includes('--enable') }).catch(error => {
  // Error codes originate in the verifier; do not emit upstream response bodies.
  const code = /^[a-zA-Z0-9_/-]{1,180}$/.test(error.message) ? error.message : 'verification_failed';
  console.log(`AUTOPILOT_VERIFY_FAILED ${JSON.stringify({ at: new Date().toISOString(), checkId: CHECK_ID, code })}`); process.exitCode = 1;
});
