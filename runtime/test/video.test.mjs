import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { renderVideo, validateVideoInput, VIDEO_LIMITS, videoRuntimeStatus } from '../lib/video.mjs';

const execute = promisify(execFile);
const sample = () => ({ title: '블랙홀 영상 제작', scenes: [{ heading: '한끼의 안부를\n가볍게 전하세요', body: '장면 문구가 실제 MP4 파일이 됩니다.\n무음 영상입니다.', seconds: 2 }, { heading: '결과를 저장하고\n다시 확인하세요', body: '원본 한글 텍스트 카드', seconds: 2 }] });
const rejectsCode = code => error => error.code === code;
async function directory(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'blackhole-video-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const runtime = await videoRuntimeStatus();
const renderOptions = { skip: !runtime.available && process.env.YENO_VIDEO_TEST_REQUIRED !== '1', timeout: 90_000 };

test('video inputs are strict, bounded and copied without modifying the owner input', () => {
  const input = sample(), before = structuredClone(input);
  const result = validateVideoInput(input);
  assert.deepEqual(input, before); assert.deepEqual(result, input); assert.notEqual(result.scenes, input.scenes);
  for (const input of [null, [], {}, { ...sample(), sourceUrl: 'https://example.com' }, { ...sample(), command: 'echo unsafe' }, { ...sample(), fontPath: '/tmp/unsafe.ttf' }]) assert.throws(() => validateVideoInput(input), rejectsCode('invalid_video_input'));
  for (const title of ['', ' ', '가'.repeat(61), 42, '첫째\n둘째', '가\u0000나', '가\u001b나', '가\u202e나', '가\u200d나']) assert.throws(() => validateVideoInput({ ...sample(), title }), rejectsCode('invalid_video_input'));
  for (const seconds of [0, 1, 11, 1.5, '2', Infinity]) assert.throws(() => validateVideoInput({ ...sample(), scenes: [{ ...sample().scenes[0], seconds }] }), rejectsCode('invalid_video_input'));
  for (const scenes of [[], Array(7).fill(sample().scenes[0]), [{ ...sample().scenes[0], body: 'x'.repeat(181) }], [{ ...sample().scenes[0], heading: 'x'.repeat(71) }], [{ ...sample().scenes[0], filename: 'outside.png' }]]) assert.throws(() => validateVideoInput({ ...sample(), scenes }), rejectsCode('invalid_video_input'));
  assert.equal(validateVideoInput({ title: '최대 길이', scenes: Array(6).fill({ heading: '장면', body: '설명', seconds: 10 }) }).scenes.reduce((sum, scene) => sum + scene.seconds, 0), VIDEO_LIMITS.durationSeconds);
});

test('video shell/filter characters remain literal data instead of command arguments', () => {
  const malicious = "$(touch /tmp/blackhole-injection) `id` %{eif:1:d} ' : \\";
  const result = validateVideoInput({ title: '문자 검사', scenes: [{ heading: '문자는 그대로', body: malicious, seconds: 2 }] });
  assert.equal(result.scenes[0].body, malicious);
});

test('pre-aborted video never creates staging files or touches an existing result', async t => {
  const dir = await directory(t), outputPath = path.join(dir, 'existing.mp4');
  await writeFile(outputPath, 'owner result');
  const control = new AbortController(); control.abort();
  await assert.rejects(renderVideo({ input: sample(), outputPath, signal: control.signal }), rejectsCode('video_aborted'));
  assert.equal(await readFile(outputPath, 'utf8'), 'owner result'); assert.deepEqual(await readdir(dir), ['existing.mp4']);
});

test('real Korean vertical MP4 has valid H264 frames, no audio, verified bytes and font evidence', renderOptions, async t => {
  assert.equal(runtime.available, true, runtime.reason);
  const dir = await directory(t), outputPath = path.join(dir, 'result.mp4'), stages = [];
  const receipt = await renderVideo({ input: sample(), outputPath, onProgress: progress => stages.push(progress.stage) });
  const file = await readFile(outputPath);
  assert.equal(receipt.sha256, createHash('sha256').update(file).digest('hex')); assert.equal(receipt.bytes, file.length);
  assert.equal(file.subarray(4, 8).toString(), 'ftyp'); assert.equal(receipt.durationSeconds, 4);
  assert.equal(receipt.width, 720); assert.equal(receipt.height, 1280); assert.equal(receipt.fps, 24); assert.equal(receipt.audio, false); assert.equal(receipt.providerCalls, 0); assert.equal(receipt.mimeType, 'video/mp4');
  assert.match(receipt.fontSha256, /^[0-9a-f]{64}$/); assert.match(receipt.fontFamily, /Nanum/i); assert.match(receipt.fontLicense, /nanumgothic\/OFL\.txt$/);
  const decoded = JSON.parse((await execute('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', outputPath])).stdout);
  assert.deepEqual(decoded.streams, [{ codec_name: 'h264', width: 720, height: 1280, nb_read_frames: '96' }]);
  await execute('ffmpeg', ['-v', 'error', '-xerror', '-threads', '1', '-i', outputPath, '-f', 'null', '-']);
  assert.deepEqual(await readdir(dir), ['result.mp4']); assert.ok(stages.includes('encoding')); assert.equal(stages.at(-1), 'saving');
  await assert.rejects(renderVideo({ input: sample(), outputPath }), rejectsCode('video_output_exists'));
  assert.equal(createHash('sha256').update(await readFile(outputPath)).digest('hex'), receipt.sha256);
});

test('literal command-looking scene text renders with no shell side effects', renderOptions, async t => {
  const dir = await directory(t), outputPath = path.join(dir, 'literal.mp4');
  const input = { title: '문자 그대로', scenes: [{ heading: '필터 문자열 검사', body: "$(touch injected) `id` %{eif:1:d} ; ' \\", seconds: 2 }] };
  const receipt = await renderVideo({ input, outputPath });
  assert.equal(receipt.durationSeconds, 2); assert.deepEqual(await readdir(dir), ['literal.mp4']);
});

test('maximum 60-second dense Korean input stays within the 2MiB artifact cap', renderOptions, async t => {
  const dir = await directory(t), outputPath = path.join(dir, 'maximum.mp4');
  const input = { title: '제'.repeat(60), scenes: Array.from({ length: 6 }, (_, index) => ({ heading: '장'.repeat(69) + String(index), body: '한글'.repeat(90), seconds: 10 })) };
  const receipt = await renderVideo({ input, outputPath });
  assert.equal(receipt.durationSeconds, 60); assert.ok(receipt.bytes < 2 * 1024 * 1024); assert.deepEqual(await readdir(dir), ['maximum.mp4']);
});

test('abort during FFmpeg encoding kills the child and cleans only owned staging files', renderOptions, async t => {
  const dir = await directory(t), outputPath = path.join(dir, 'aborted.mp4'), control = new AbortController();
  await writeFile(path.join(dir, 'owner.txt'), 'preserved');
  let timer;
  await assert.rejects(renderVideo({ input: { ...sample(), scenes: [{ ...sample().scenes[0], seconds: 10 }] }, outputPath, signal: control.signal, onProgress: ({ stage }) => { if (stage === 'encoding') timer = setTimeout(() => control.abort(), 25); } }), rejectsCode('video_aborted'));
  clearTimeout(timer); assert.deepEqual(await readdir(dir), ['owner.txt']); assert.equal(await readFile(path.join(dir, 'owner.txt'), 'utf8'), 'preserved');
  await assert.rejects(stat(outputPath), { code: 'ENOENT' });
});

test('missing glyphs fail explicitly without a tofu-text video or partial artifact', renderOptions, async t => {
  const dir = await directory(t), outputPath = path.join(dir, 'unsupported.mp4');
  await assert.rejects(renderVideo({ input: { title: '폰트 검사', scenes: [{ heading: '없는 문자', body: '문자 \u{10ffff}', seconds: 2 }] }, outputPath }), rejectsCode('video_unsupported_glyph'));
  assert.deepEqual(await readdir(dir), []);
});

test('atomic publication detects a competing result without overwriting it', renderOptions, async t => {
  const dir = await directory(t), outputPath = path.join(dir, 'race.mp4');
  await assert.rejects(renderVideo({ input: { ...sample(), scenes: [sample().scenes[0]] }, outputPath, onProgress: async ({ stage }) => { if (stage === 'saving') await writeFile(outputPath, 'owner won the race', { flag: 'wx' }); } }), rejectsCode('video_output_exists'));
  assert.equal(await readFile(outputPath, 'utf8'), 'owner won the race'); assert.deepEqual(await readdir(dir), ['race.mp4']);
});
