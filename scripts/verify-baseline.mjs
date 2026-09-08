import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'RELEASE_MANIFEST.json'), 'utf8'));
if (manifest.version !== '0.1.1' || !Array.isArray(manifest.files)) {
  throw new Error('Unexpected runtime baseline manifest');
}
for (const entry of manifest.files) {
  const absolute = path.resolve(runtime, entry.path);
  const relative = path.relative(runtime, absolute);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Manifest path is outside runtime');
  }
  const bytes = fs.readFileSync(absolute);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== entry.sha256 || bytes.length !== entry.bytes) {
    throw new Error(`Baseline differs: ${entry.path}. Check whether this is an intentional source edit.`);
  }
}
console.log(`Verified ${manifest.files.length} baseline files for runtime ${manifest.version}.`);
console.log('This verifies source integrity only; it does not verify a native app or deployment.');
