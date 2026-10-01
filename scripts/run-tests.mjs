import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir,freemem,totalmem} from 'node:os';
import {join, isAbsolute} from 'node:path';
import {discoverTests,partitionTests,parseTierArguments,FAST_TESTS} from './test-tiers.mjs';

let selection;
try { selection = parseTierArguments(process.argv.slice(2)); }
catch (error) { console.error(`Test tier selection failed: ${error.message}`); process.exit(2); }
const allTests = discoverTests();
const missingFast = FAST_TESTS.filter(path => !allTests.includes(path));
if (missingFast.length) { console.error(`Fast test manifest has missing files: ${missingFast.join(', ')}`); process.exit(2); }
const tiers = partitionTests(allTests);
const selectedTests = tiers[selection.tier];
if (selection.list) {
  console.log(JSON.stringify({tier:selection.tier,changedFiles:selection.changedFiles,counts:{fast:tiers.fast.length,integration:tiers.integration.length,full:tiers.full.length},files:selectedTests},null,2));
  process.exit(0);
}

const affectedWindowsNode=process.platform==='win32'&&process.versions.node==='24.11.1';
const override=process.env.YENO_TEST_NODE;
const bundled=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','bin','node.exe');
const executable=override|| (affectedWindowsNode?bundled:process.execPath);

if(!isAbsolute(executable)||!existsSync(executable)){
  console.error(affectedWindowsNode
    ? 'Node v24.11.1 crashes on Windows Unicode-path cleanup. Set YENO_TEST_NODE to a working Node 24 executable or install a newer Node.'
    : `Test Node executable is unavailable: ${executable}`);
  process.exit(1);
}

if(executable!==process.execPath){
  const version=spawnSync(executable,['--version'],{encoding:'utf8',windowsHide:true});
  const match=/^v(\d+)\.(\d+)\.(\d+)/.exec(version.stdout?.trim()||'');
  if(version.status!==0||!match||Number(match[1])<24||(process.platform==='win32'&&match[1]==='24'&&Number(match[2])===11&&Number(match[3])===1)){
    console.error('YENO_TEST_NODE must point to a working Node 24 or newer executable.');
    process.exit(1);
  }
  console.log(`Using test Node ${version.stdout.trim()} from ${executable}`);
}

// QuickJS worker startup shares the host with other test files. On an 8 GiB
// Windows PC, four files can starve a 2 s sandbox deadline even for valid code.
const GiB=1024**3;
const lowMemory=totalmem()<8*GiB||freemem()<3*GiB;
const concurrency=lowMemory?1:4;
console.log(`Test file concurrency ${concurrency} (available RAM ${(freemem()/GiB).toFixed(2)} GiB)`);
// The scheduler capacity regression parses a 17 MiB state several times.
// On this 7.73 GiB host the default Node heap limit is about 2.2 GiB;
// A 768 MiB cap still failed intermittently with under 0.5 GiB free RAM.
// The unchanged scheduler test completed six consecutive isolated runs with
// 512 and 384 MiB caps, so leave more physical headroom for the test child.
const heapArgs=lowMemory?['--max-old-space-size=512']:[];
if(lowMemory)console.log('Test child heap cap 512 MiB on low-memory host');
console.log(`Test tier ${selection.tier}: ${selectedTests.length} files`);
const args=[...heapArgs,'--test',`--test-concurrency=${concurrency}`,...selectedTests];
const result=spawnSync(executable,args,{stdio:'inherit',windowsHide:true});
if(result.error)console.error(`Test runner failed to start: ${result.error.message}`);
process.exitCode=result.status??1;
