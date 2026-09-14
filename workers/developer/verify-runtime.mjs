// Fixed validation entrypoint. Candidate code cannot select its own commands.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const tests=['runtime/test','apps/controller/test'].flatMap(dir=>fs.readdirSync(dir).filter(f=>f.endsWith('.test.mjs')).map(f=>dir+'/'+f));
tests.push('scripts/native-config.test.mjs');
execFileSync(process.execPath,['--test','--test-concurrency=2',...tests],{stdio:'inherit',timeout:480000});
execFileSync(process.execPath,['scripts/verify-web-ui.mjs'],{stdio:'inherit',timeout:60000});
execFileSync(process.execPath,['scripts/verify-research-ui.mjs'],{stdio:'inherit',timeout:60000});
