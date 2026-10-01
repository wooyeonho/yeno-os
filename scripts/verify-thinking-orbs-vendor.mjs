import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runtime/public/vendor/thinking-orbs');
const check = (list, prefix) => {
  let count = 0;
  for (const line of fs.readFileSync(path.join(root, list), 'utf8').trim().split(/\r?\n/)) {
    const match = /^([^ ]+) ([a-f0-9]{64})$/.exec(line.trim());
    if (!match) throw Error(`Invalid ${list} entry`);
    const file = path.resolve(root, prefix, match[1]);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.statSync(file).isFile()) throw Error('Invalid vendor path');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== match[2]) throw Error(`Vendor hash mismatch: ${match[1]}`);
    count++;
  }
  return count;
};
const source = check('SOURCE_SHA256.txt', '');
const adapted = check('ADAPTED_SHA256.txt', 'adapted');
console.log(JSON.stringify({source, adapted, license:'MIT', pinnedCommit:'de85557ca220332586d070d8788c0e1d6e877a0d'}));
