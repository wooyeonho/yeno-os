#!/usr/bin/env node
// Run only in the existing owner's core container. The public request reference
// is not a credential; authorization comes from the container's existing key.
const id = process.argv[2];
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id ?? '')) {
  process.stderr.write('Usage: node scripts/approve-browser.mjs <request reference shown on your browser>\n');
  process.exitCode = 1;
} else if (!process.env.YENO_TOKEN) {
  process.stderr.write('Run this command in the existing BLACKHOLE core console. No connection key is printed or requested.\n');
  process.exitCode = 1;
} else {
  try {
    const port = process.env.YENO_PORT || '8790';
    if (!/^\d{1,5}$/.test(port)) throw new Error('port');
    const response = await fetch(`http://127.0.0.1:${port}/api/web/pairing/approve`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: {Authorization: `Bearer ${process.env.YENO_TOKEN}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({requestId: id}),
    });
    const value = await response.json();
    if (!response.ok || value.id !== id || value.status !== 'approved') {
      process.stderr.write(`Connection approval was not confirmed (HTTP ${response.status}). Retry the same reference if the response was lost; expired requests need a new browser request.\n`);
      process.exitCode = 1;
    } else process.stdout.write(`BROWSER_APPROVED ${id}\nThe requesting browser will connect automatically.\n`);
  } catch {
    process.stderr.write('Approval response unavailable. Keep the same reference and retry; do not create another approval.\n');
    process.exitCode = 1;
  }
}
