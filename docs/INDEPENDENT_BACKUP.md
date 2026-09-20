# Independent encrypted-backup retention

The core backup format remains `runtime/lib/backup.mjs`. The retention adapter in
`scripts/backup-retention.mjs` does not create a second backup format or touch the
live data directory. It verifies an existing encrypted archive through the
canonical `decryptBackup` function, then writes the archive and a non-secret
manifest into a separately provisioned directory.

This closes the code-level gap between “temporary export/restore tested” and
“independent backup can be retained and checked”. It is not a claim that a
cloud/NAS copy exists until the owner runs it and verifies the result.

## Safe owner flow

1. Create an encrypted archive with the existing `scripts/backup.mjs export`.
2. Put the archive in a private temporary directory and create a separate backup
   directory on another disk, volume, or storage account. Do not make the target
   directory a symlink or a child of the archive's source directory.
3. Store and verify it:

```text
node scripts/backup-retention-cli.mjs store \
  --archive /private/export.yenobk \
  --key-file /private/backup-key.hex \
  --target /separate/blackhole-backups \
  --source-ref koyeb-export \
  --max-backups 7 --prune

node scripts/backup-retention-cli.mjs verify \
  --archive /private/export.yenobk \
  --key-file /private/backup-key.hex \
  --target /separate/blackhole-backups
```

The CLI never prints the key, stores it in the manifest, or sends it to the
core. The manifest contains only archive hash/size, archive creation time,
bounded record counts, and the operator-supplied source label. Repeating the
same archive is idempotent. Pruning is opt-in and removes only older records
whose own manifest and filename validate.

## Current verification boundary

- Structural and synthetic tests cover independent-path checks, symlink refusal,
  atomic write, archive hash verification, idempotent replay, and bounded
  retention.
- A real second disk/NAS/cloud location, scheduled execution, and disaster
  restore are still owner-run acceptance steps.
- Do not mark the BLACKHOLE backup gate as live until `store` and `verify` have
  been run against the chosen independent location and a new-directory restore
  has been checked.
