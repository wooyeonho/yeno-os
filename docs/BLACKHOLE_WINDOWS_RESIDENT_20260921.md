# BLACKHOLE Windows resident core — corrected standalone slice

## What this is, and what it is not

PR #50 was not usable on Windows: its PowerShell was corrupted, it invoked a Linux-only container lease, and the green Linux tests did not execute the installer. This revision replaces that path and adds real Windows CI. Do not use the earlier launcher at `5cd7296`.

This is a **separate, owner-initialized local core**. It reuses the existing server, job engine, store lock, device API, memory and recovery behavior. It does not import or synchronize the existing Koyeb core, older local 0.2.3 installation, projects or credentials. Both phone and PC must point to the SAME chosen core to share state. Changing the phone's existing core requires an owner decision; this slice does not perform that switch.

Laptop powered off, sleeping, or signed out means this interactive-user local core is unavailable. Task Scheduler restarts it when the owner logs in; this is not 24/7 cloud hosting and not a Windows EXE installer. Production is unchanged.

## First setup on Windows

Use Node.js 24+ and the reviewed PR #50 source. Keep the checkout in a stable location owned by the Windows user. Install locked runtime dependencies without lifecycle scripts:

```powershell
npm ci --prefix runtime --ignore-scripts --no-audit --no-fund
.\scripts\blackhole-resident.ps1 -Action install -InitializeNewStore
.\scripts\blackhole-resident.ps1 -Action status
```

Run under Windows PowerShell 5.1 according to the machine's existing execution policy; no policy or administrator permission is silently changed. The scheduled task directly invokes the resolved Node executable, not another PowerShell launcher.

The explicit flag acknowledges creation of a NEW local store. Pairing-key entry is masked. Use a unique key of 16–512 non-whitespace characters; do not paste it into chat. Existing keys are preserved on reinstall. A nonempty unconfigured directory is rejected instead of migrated.

Defaults:
- Task: `BLACKHOLE Core v2` (does not take over an older `BLACKHOLE Core` task).
- Home: `%LOCALAPPDATA%\BLACKHOLE\resident-v2`.
- Local core: `http://127.0.0.1:8790`; `-Port` selects a different port at first install. Port 9443 is reserved.
- Data, control records and secrets have current-user-only directory ACLs; files inherit those ACLs. Windows administrators/compromised owner accounts remain privileged.
- `owner.json` binds installation, account, exact task action and Node path.
- Task uses Interactive login, limited privilege, IgnoreNew, no 72-hour expiry, up to five one-minute failure restarts.
- Runtime configuration is explicit. Inherited cloud/proxy/provider environment values are not imported. **Real multi-provider execution is not enabled by this installer.**

`status` reports authenticated local HTTP readiness, not just task registration. Retrying `install` preserves data, key, port and installation identity. It does not authorize a second core against the same store.

## Start, stop, restart and uninstall

```powershell
.\scripts\blackhole-resident.ps1 -Action stop
.\scripts\blackhole-resident.ps1 -Action start
.\scripts\blackhole-resident.ps1 -Action restart
.\scripts\blackhole-resident.ps1 -Action uninstall
```

Stop uses an instance-bound nonce, calls the existing runtime shutdown, waits for server/owned bridge termination, and preserves jobs paused. Restart does not resume unfinished work or replay unknown provider outcomes. Uninstall removes only the verified owned task; **data and pairing keys remain**. No broad kill, recursive delete, forced takeover or token deletion option exists.

Foreign task descriptions/actions/accounts are refused even if the task name matches. A dead core may be restarted after its actual exit is observed. If a recorded bridge process still exists after an abrupt core crash, restart/uninstall is blocked for owner inspection: PID reuse means it is not safe to blindly kill that process. No Tailscale reset is issued. Metadata-write or shutdown failures are reported as failures rather than successful cleanup.

## Optional private phone bridge

First install and sign in to Tailscale on the Windows PC and Android phone yourself, in the intended private tailnet. The owner must allow Serve/HTTPS and appropriate tailnet access. This implementation does not create accounts, accept terms, expose Funnel, open Windows firewall ports, or change existing Tailscale configuration.

```powershell
.\scripts\blackhole-resident.ps1 -Action phone-install
.\scripts\blackhole-resident.ps1 -Action status
.\scripts\blackhole-resident.ps1 -Action phone-uninstall
```

There is ONE resident task. Its supervisor owns a foreground `tailscale serve --https=9443 http://127.0.0.1:<configured-port>` child. Existing Serve configuration, including nested foreground routes, is conservatively rejected; no route is overwritten even when the hostname matches. Each startup rechecks daemon identity and configuration. A conflict leaves the local core running with phone access blocked.

The core permits only the explicit MagicDNS host. Phone status becomes `available` only after an actual TLS-validated HTTPS `/api/health` response with the expected protocol; a launched process alone is not readiness. This proves host-side HTTPS reachability, **not a physical Android test**. If setup is blocked, the local core remains usable; use `phone-uninstall` to return to local-only operation.

`phone-uninstall` gracefully stops the owned foreground bridge, restarts the same core without the phone Host allowlist, and never resets unrelated routes. Bridge loss becomes pending/unavailable; repeating phone-install does not treat a healthy local core as proof of phone connectivity.

For a new test client only, use the status `phoneUrl` as its core address. Do not delete the existing APK, vault, request IDs or cloud enrollment.

## Evidence and acceptance

Local Node tests execute actual temporary HTTP servers, state/artifact files, enrollment and request replay. They cover standalone boot, isolation from inherited credentials, host/auth rejection, duplicate writer/port conflicts, durable result/identity, paused work, emergency-stop persistence, unknown-call hold, nonce-bound stop and metadata failure cleanup. Tailscale child/probe fault tests use injected synthetic adapters.

`.github/workflows/windows-resident.yml` runs on a real Windows host:
1. Those Node tests on Windows.
2. Windows PowerShell 5.1 AST parsing (catches malformed syntax and duplicated functions).
3. Actual temporary Task Scheduler registration, settings and ownership checks.
4. Native API enrollment → document → downloaded SHA-256 → stop/restart → same request/job/result.
5. Emergency stop across restart, key preservation and uninstall preservation.
6. Sanitized evidence only; no runtime data, secrets or auth headers are uploaded.

The existing developer-worker workflow separately runs complete Linux regression, web UI and networkless/read-only Docker isolation. Check **both exact-head checks** on PR #50. Writing the workflow is not a successful run; the PR report links actual results after they finish.

Still requires physical acceptance:
- Owner laptop installation, sign-out/sign-in and sleep/wake behavior.
- Real Tailscale account/Serve consent, private TLS route and bridge revocation.
- Android APK or phone browser command → result → close → reopen → same result.
- Explicit decision about existing cloud-core vs new local-core data ownership; no live migration was done.
- No EXE or APK is built by this backend/launcher-only slice.

## Rollback

On the installed revision, use `-Action phone-uninstall` if configured, then `-Action uninstall`. Preserve the home directory and checkout for recovery. Do not roll back to the broken `5cd7296` launcher. Existing cloud services and earlier installations remain untouched.
