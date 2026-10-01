import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runtime/public/vendor/thinking-orbs');
const source = path.join(root, 'src/engine');
const target = path.join(root, 'adapted');
const modules = ['core', 'braid', 'lattice', 'morph', 'orbits', 'profiles', 'ribbon', 'web', 'registry'];
fs.mkdirSync(target, {recursive: true});
for (const name of modules) {
  const input = fs.readFileSync(path.join(source, `${name}.ts`), 'utf8');
  const stripped = stripTypeScriptTypes(input, {mode: 'strip', sourceUrl: `${name}.ts`});
  const browserModule = stripped.replace(/(from\s+['"]\.\/[^.'"]+)(['"])/g, '$1.mjs$2');
  fs.writeFileSync(path.join(target, `${name}.mjs`), `// Generated from pinned thinking-orbs TypeScript source. See ../VENDOR.md.\n${browserModule}`);
}
const presets = fs.readFileSync(path.join(root, 'src/presets.ts'), 'utf8');
const presetJs = stripTypeScriptTypes(presets, {mode: 'strip', sourceUrl: 'presets.ts'})
  .replace(/from\s+(['"])\.\/engine\/profiles\1/g, "from './profiles.mjs'");
fs.writeFileSync(path.join(target, 'presets.mjs'), `// Generated from pinned thinking-orbs TypeScript source. See ../VENDOR.md.\n${presetJs}`);
