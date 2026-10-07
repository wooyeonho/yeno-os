import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, link, lstat, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIDEO_LIMITS = Object.freeze({ width: 720, height: 1280, fps: 24, scenes: 6, durationSeconds: 60, bytes: 2 * 1024 * 1024, timeoutMs: 180_000 });
export const VIDEO_FONT_LICENSE = 'https://github.com/google/fonts/blob/main/ofl/nanumgothic/OFL.txt';
const rasterScript = fileURLToPath(new URL('../../scripts/render-video-runtime.py', import.meta.url));
const defaultFont = '/usr/share/fonts/truetype/nanum/NanumGothic.ttf';
const fixedEnv = () => ({ PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => record(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const cancelled = () => new VideoError('video_aborted', '영상 제작이 중단되었습니다.', 409);
const checkAbort = signal => { if (signal?.aborted) throw cancelled(); };

export class VideoError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'VideoError'; this.code = code; this.status = status; }
}

function text(value, max, title = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(value) || (title && value.includes('\n'))) {
    throw new VideoError('invalid_video_input', `영상 문구를 확인하세요. 제목은 60자, 장면 제목은 70자, 설명은 180자 이내입니다.`);
  }
  return value.trim().normalize('NFC');
}

export function validateVideoInput(input) {
  if (!exact(input, ['title', 'scenes']) || !Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > VIDEO_LIMITS.scenes) {
    throw new VideoError('invalid_video_input', '영상 제목과 1~6개의 장면이 필요합니다.');
  }
  const title = text(input.title, 60, true);
  const scenes = input.scenes.map(scene => {
    if (!exact(scene, ['heading', 'body', 'seconds']) || !Number.isInteger(scene.seconds) || scene.seconds < 2 || scene.seconds > 10) {
      throw new VideoError('invalid_video_input', '각 장면에는 제목, 설명과 2~10초의 정수 길이가 필요합니다.');
    }
    return { heading: text(scene.heading, 70), body: text(scene.body, 180), seconds: scene.seconds };
  });
  if (scenes.reduce((sum, scene) => sum + scene.seconds, 0) > VIDEO_LIMITS.durationSeconds) throw new VideoError('invalid_video_input', '영상 길이는 60초 이내로 설정하세요.');
  return { title, scenes };
}

// One encoder per core process, including callers outside the durable scheduler.
let tail = Promise.resolve();
async function acquire(signal) {
  checkAbort(signal);
  const previous = tail;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  tail = previous.then(() => held);
  let abort;
  try {
    await Promise.race([previous, new Promise((_, reject) => {
      abort = () => reject(cancelled());
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    })]);
    checkAbort(signal);
    return release;
  } catch (error) { release(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}

function run(command, args, { signal, timeoutMs = 45_000 } = {}) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: fixedEnv(), windowsHide: true });
    const stdout = [], stderr = [];
    let total = 0, terminalError;
    const stop = error => { terminalError ||= error; child.kill('SIGKILL'); };
    const abort = () => stop(cancelled());
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => stop(new VideoError('video_timeout', '영상 제작 시간 한도를 넘었습니다. 장면 수를 줄여 다시 실행하세요.', 409)), timeoutMs);
    const receive = target => chunk => {
      total += chunk.length;
      if (total > 256 * 1024) stop(new VideoError('video_process_output_limit', '영상 처리 응답 한도를 넘었습니다.', 500));
      else target.push(chunk);
    };
    child.stdout.on('data', receive(stdout)); child.stderr.on('data', receive(stderr));
    child.on('error', error => { terminalError ||= new VideoError(error.code === 'ENOENT' ? 'video_runtime_missing' : 'video_process_failed', '영상 제작 도구를 실행하지 못했습니다. 서버의 FFmpeg·Python·한글 폰트를 확인하세요.', 503); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (terminalError) return reject(terminalError);
      if (code !== 0) {
        const details = Buffer.concat(stderr).toString('utf8');
        if (details.includes('VIDEO_FONT_MISSING_GLYPH')) return reject(new VideoError('video_unsupported_glyph', '한글·영문·숫자·기본 기호로 입력하세요. 현재 폰트가 표시할 수 없는 문자가 있습니다.'));
        if (details.includes('VIDEO_TEXT_OVERFLOW')) return reject(new VideoError('video_text_overflow', '장면 문구가 화면에 다 들어가지 않습니다. 줄바꿈이나 문구 길이를 줄여 주세요.'));
        return reject(new VideoError('video_process_failed', '영상 제작 또는 결과 검증에 실패했습니다. 기존 결과는 유지됩니다.', 500));
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

export async function videoRuntimeStatus() {
  const fontPath = process.env.YENO_VIDEO_FONT_PATH || defaultFont;
  try {
    await access(fontPath, constants.R_OK);
    await access(rasterScript, constants.R_OK);
    await run('python3', ['-I', '-c', 'import PIL, fontTools'], { timeoutMs: 5000 });
    await run('ffmpeg', ['-version'], { timeoutMs: 5000 });
    await run('ffprobe', ['-version'], { timeoutMs: 5000 });
    return { available: true, mimeType: 'video/mp4', audio: false, providerCalls: 0, ...VIDEO_LIMITS };
  } catch {
    return { available: false, reason: '서버에 ffmpeg, python3-pil, python3-fonttools, fonts-nanum이 필요합니다.', mimeType: 'video/mp4', audio: false, providerCalls: 0, ...VIDEO_LIMITS };
  }
}

export const videoAvailability = videoRuntimeStatus;

export async function renderVideo({ input, outputPath, signal, onProgress } = {}) {
  const data = validateVideoInput(input);
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || path.extname(outputPath) !== '.mp4' || /[\u0000-\u001f\u007f]/.test(outputPath)) throw new VideoError('invalid_video_output', '영상 저장 위치가 올바르지 않습니다.', 500);
  const notify = async (stage, completed = 0) => { checkAbort(signal); if (onProgress) await onProgress({ stage, completed, total: data.scenes.length }); checkAbort(signal); };
  await notify('waiting');
  const release = await acquire(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let work, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, VIDEO_LIMITS.timeoutMs);
  const ctx = { signal: controller.signal };
  try {
    checkAbort(controller.signal);
    try { await lstat(outputPath); throw new VideoError('video_output_exists', '같은 경로의 결과가 이미 있어 덮어쓰지 않았습니다.', 409); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = await stat(path.dirname(outputPath));
    if (!parent.isDirectory()) throw new VideoError('invalid_video_output', '영상 저장 폴더가 없습니다.', 500);
    const fontPath = process.env.YENO_VIDEO_FONT_PATH || defaultFont;
    try { if (!(await stat(fontPath)).isFile()) throw new Error(); }
    catch { throw new VideoError('video_font_missing', '서버의 한글 폰트 연결이 필요합니다.', 503); }
    work = await mkdtemp(path.join(path.dirname(outputPath), '.blackhole-video-'));
    const manifest = path.join(work, 'input.json');
    const raw = JSON.stringify(data);
    await writeFile(manifest, raw, { flag: 'wx', mode: 0o600 });
    await notify('drawing');
    const fontReceipt = JSON.parse(await run('python3', ['-I', rasterScript, manifest, work, fontPath], { ...ctx, timeoutMs: 20_000 }));
    for (let index = 0; index < data.scenes.length; index++) {
      checkAbort(controller.signal);
      await notify('encoding', index);
      await run('ffmpeg', ['-nostdin', '-v', 'error', '-n', '-timelimit', '35', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-loop', '1', '-framerate', String(VIDEO_LIMITS.fps), '-i', path.join(work, `scene-${index}.png`), '-t', String(data.scenes[index].seconds), '-an', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-fs', String(VIDEO_LIMITS.bytes), path.join(work, `scene-${index}.mp4`)], ctx);
    }
    const playlist = path.join(work, 'concat.txt');
    await writeFile(playlist, data.scenes.map((_, index) => `file 'scene-${index}.mp4'\n`).join(''), { flag: 'wx', mode: 0o600 });
    const rendered = path.join(work, 'complete.mp4');
    await notify('verifying', data.scenes.length);
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-n', '-timelimit', '15', '-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '1', '-i', playlist, '-c', 'copy', '-movflags', '+faststart', '-fs', String(VIDEO_LIMITS.bytes), rendered], { ...ctx, timeoutMs: 20_000 });
    const result = await stat(rendered);
    if (!result.isFile() || result.size < 1000 || result.size > VIDEO_LIMITS.bytes) throw new VideoError('video_size_limit', '영상 파일 크기 검증에 실패했습니다.', 500);
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', rendered], { ...ctx, timeoutMs: 10_000 }));
    const durationSeconds = data.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
    const stream = probe.streams?.[0];
    if (probe.streams?.length !== 1 || stream.codec_type !== 'video' || stream.codec_name !== 'h264' || stream.width !== VIDEO_LIMITS.width || stream.height !== VIDEO_LIMITS.height || stream.pix_fmt !== 'yuv420p' || stream.avg_frame_rate !== '24/1' || !Number.isFinite(Number(probe.format?.duration)) || Math.abs(Number(probe.format.duration) - durationSeconds) > 0.1 || Number(stream.nb_frames) !== durationSeconds * VIDEO_LIMITS.fps) throw new VideoError('video_verification_failed', '영상 길이·화면·프레임 검증에 실패했습니다.', 500);
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-timelimit', '25', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-i', rendered, '-f', 'null', '-'], { ...ctx, timeoutMs: 35_000 });
    await chmod(rendered, 0o600);
    const sha256 = createHash('sha256').update(await readFile(rendered)).digest('hex');
    const handle = await open(rendered, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    await notify('saving', data.scenes.length);
    checkAbort(controller.signal);
    // Hard-link publication is atomic AND exclusive; rename would overwrite an existing result.
    try { await link(rendered, outputPath); }
    catch (error) { if (error.code === 'EEXIST') throw new VideoError('video_output_exists', '기존 영상 결과를 보존했습니다.', 409); throw error; }
    const parentHandle = await open(path.dirname(outputPath), 'r');
    try { await parentHandle.sync(); } finally { await parentHandle.close(); }
    return { durationSeconds, width: VIDEO_LIMITS.width, height: VIDEO_LIMITS.height, fps: VIDEO_LIMITS.fps, bytes: result.size, mimeType: 'video/mp4', sha256, codec: 'h264', audio: false, providerCalls: 0, published: false, inputSha256: createHash('sha256').update(raw).digest('hex'), fontFamily: fontReceipt.fontFamily, fontSha256: fontReceipt.fontSha256, fontLicense: VIDEO_FONT_LICENSE };
  } catch (error) {
    if (timedOut) throw new VideoError('video_timeout', '영상 제작 시간 한도를 넘었습니다.', 409);
    if (error instanceof VideoError) throw error;
    throw new VideoError('video_render_failed', '영상 파일 제작을 완료하지 못했습니다. 기존 결과는 유지됩니다.', 500);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
    release();
  }
}
