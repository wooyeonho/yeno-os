# BLACKHOLE resident core. Windows PowerShell 5.1; no production migration.
[CmdletBinding()]
param(
  [ValidateSet('install','start','stop','restart','status','uninstall','run','phone-install','phone-uninstall')]
  [string]$Action = 'status',
  [string]$Root = (Join-Path $PSScriptRoot '..'),
  [string]$HomeDir = (Join-Path $env:LOCALAPPDATA 'BLACKHOLE\resident-v2'),
  [string]$TaskName = 'BLACKHOLE Core v2',
  [ValidateRange(1024,65535)][int]$Port = 8790,
  [switch]$InitializeNewStore,
  [Security.SecureString]$PairingToken,
  [string]$TailscalePath
)

$ErrorActionPreference = 'Stop'
$PortWasSpecified = $PSBoundParameters.ContainsKey('Port')
$Root = [IO.Path]::GetFullPath($Root)
$HomeDir = [IO.Path]::GetFullPath($HomeDir)
$ScriptPath = Join-Path $Root 'scripts\blackhole-resident.ps1'
$ConfigPath = Join-Path $HomeDir 'config.json'
$OwnerPath = Join-Path $HomeDir 'owner.json'
$ControlDir = Join-Path $HomeDir 'control'
$InstancePath = Join-Path $ControlDir 'instance.json'
$TokenFile = Join-Path $HomeDir 'secrets\pairing.token'
$DataDir = Join-Path $HomeDir 'data'
$Utf8 = New-Object Text.UTF8Encoding($false)

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  if ((Get-Item -LiteralPath $Path).Length -gt 65536) { throw 'Resident metadata exceeds its size limit.' }
  return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
}
function Write-Json([string]$Path, $Value) {
  $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
  [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 8 -Compress), $Utf8)
  if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, $null) }
  else { [IO.File]::Move($temporary, $Path) }
}
function Assert-Paths {
  if ($env:OS -ne 'Windows_NT') { throw 'This launcher requires Windows.' }
  if ($Root -match '["\r\n]' -or $HomeDir -match '["\r\n]' -or $TaskName -notmatch '^[\w .-]{1,100}$') { throw 'Invalid resident path or task name.' }
  foreach ($p in @($Root,$HomeDir)) {
    $cursor = $p
    while ($cursor) {
      if (Test-Path -LiteralPath $cursor) {
        if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse-point paths are not supported.' }
      }
      $next = Split-Path -Parent $cursor
      if ($next -eq $cursor) { break }; $cursor = $next
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Root 'runtime\resident.mjs'))) { throw 'Resident runtime entrypoint is missing.' }
}
function Protect-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path | Out-Null }
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'Expected a resident directory.' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true,$false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Get-Owner {
  $owner = Read-Json $OwnerPath
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not $owner -or $owner.version -ne 1 -or $owner.ownerSid -ne $sid -or $owner.root -ne $Root -or $owner.taskName -ne $TaskName -or $owner.installId -notmatch '^[a-f0-9]{32}$' -or -not [IO.Path]::IsPathRooted([string]$owner.nodeExecutable)) {
    throw 'Resident ownership does not match. No task or data was changed.'
  }
  return $owner
}
function Get-Node {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { throw 'Install Node.js 24 LTS before using the resident core.' }
  $version = & $node.Source --version
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw 'Node.js 24 or newer is required.' }
  return $node.Source
}
function Get-TaskArguments {
  return "`"$(Join-Path $Root 'runtime\resident.mjs')`" --config `"$ConfigPath`""
}
function Get-OwnedTask {
  $owner = Get-Owner
  $task = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue
  if ($task) {
    $taskUser = $task.Principal.UserId
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($task.Description -ne "BLACKHOLE resident-v2 $($owner.installId)" -or @($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ne $owner.nodeExecutable -or $task.Actions[0].Arguments -ne (Get-TaskArguments) -or $taskUser -notin @($current.Name,$current.User.Value)) {
      throw 'Task belongs to a different installation. Refusing to stop, replace or unregister it.'
    }
  }
  return $task
}
function Get-Config {
  $null = Get-Owner
  $config = Read-Json $ConfigPath
  if (-not $config -or $config.version -ne 1 -or $config.dataDir -ne $DataDir -or $config.tokenFile -ne $TokenFile -or $config.controlDir -ne $ControlDir -or $config.port -lt 1024 -or $config.port -gt 65535) { throw 'Invalid resident configuration; no migration or repair was attempted.' }
  return $config
}
function Test-CoreHealth {
  $config = Get-Config
  $instance = Read-Json $InstancePath
  if (-not $instance -or $instance.state -ne 'running' -or $instance.port -ne $config.port) { return $false }
  if (-not (Get-Process -Id $instance.pid -ErrorAction SilentlyContinue)) { return $false }
  try {
    $secret = [IO.File]::ReadAllText($TokenFile).Trim()
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($config.port)/api/state" -Headers @{Authorization="Bearer $secret"} -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false } finally { $secret = $null }
}
function Wait-Core {
  $until = [DateTime]::UtcNow.AddSeconds(30)
  do {
    if (Test-CoreHealth) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $until)
  throw 'Core did not pass its authenticated readiness check. Inspect status; installation is not confirmed running.'
}
function Start-Core {
  $task = Get-OwnedTask
  if (-not $task) { throw 'Resident task is not installed.' }
  if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $TaskName -TaskPath '\' }
  Wait-Core
}
function Stop-Core {
  $task = Get-OwnedTask
  $instance = Read-Json $InstancePath
  if ($instance -and $instance.state -in @('starting','running','stopping')) {
    Write-Json (Join-Path $ControlDir 'stop.json') @{instanceId=$instance.instanceId}
  }
  $until = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $instance = Read-Json $InstancePath
    $task = Get-OwnedTask
    if ((-not $task -or $task.State -ne 'Running') -and (-not $instance -or $instance.state -eq 'stopped')) { return }
    if ($instance -and (-not $task -or $task.State -ne 'Running') -and -not (Get-Process -Id $instance.pid -ErrorAction SilentlyContinue)) {
      if ($instance.phonePid -and (Get-Process -Id $instance.phonePid -ErrorAction SilentlyContinue)) { throw 'Core exited but its recorded bridge process may still exist. No process was killed or route reset; owner inspection is required.' }
      # This is observed process exit, not a fabricated graceful-stop record.
      return
    }
    # A task still starting may not yet have created its instance record.
    if ($instance -and $instance.state -in @('starting','running')) {
      Write-Json (Join-Path $ControlDir 'stop.json') @{instanceId=$instance.instanceId}
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $until)
  throw 'Graceful stop was not confirmed. No process was force-killed and no task/data was removed.'
}
function Install-Core {
  if ($Port -eq 9443) { throw 'Port 9443 is reserved for private phone HTTPS.' }
  $nodeExecutable = Get-Node
  if (-not (Test-Path -LiteralPath $OwnerPath)) {
    if (-not $InitializeNewStore) { throw 'First installation requires -InitializeNewStore. This creates a separate local core, not a copy of the cloud core.' }
    if ((Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue)) { throw 'Task name is already in use; no takeover is allowed.' }
    if ((Test-Path -LiteralPath $HomeDir) -and @(Get-ChildItem -LiteralPath $HomeDir -Force).Count -gt 0) { throw 'HomeDir is not empty. Existing files will not be migrated or overwritten.' }
    Protect-Directory $HomeDir
    foreach ($p in @($DataDir,$ControlDir,(Split-Path -Parent $TokenFile))) { Protect-Directory $p }
    Write-Json $OwnerPath @{version=1;installId=[Guid]::NewGuid().ToString('N');ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;root=$Root;taskName=$TaskName;nodeExecutable=$nodeExecutable}
  }
  $owner = Get-Owner
  $task = Get-OwnedTask
  if (-not (Test-Path -LiteralPath $TokenFile)) {
    if (-not $PairingToken) { $PairingToken = Read-Host 'New local pairing key (16+ characters; never paste into chat)' -AsSecureString }
    $pointer = [IntPtr]::Zero
    try {
      $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PairingToken)
      $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
      if ($secret.Length -lt 16 -or $secret.Length -gt 512 -or $secret -match '\s') { throw 'Pairing key must be 16-512 characters without whitespace.' }
      [IO.File]::WriteAllText($TokenFile,$secret,$Utf8)
    } finally { $secret=$null; if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) } }
  }
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Json $ConfigPath @{version=1;dataDir=$DataDir;controlDir=$ControlDir;tokenFile=$TokenFile;port=$Port;phone=$null}
  }
  $config = Get-Config
  if ($PortWasSpecified -and $Port -ne $config.port) { throw 'Existing port is preserved. Use the installed configuration, not a second core.' }
  if (-not $task) {
    $taskAction = New-ScheduledTaskAction -Execute $owner.nodeExecutable -Argument (Get-TaskArguments) -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $owner.ownerSid
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
    $principal = New-ScheduledTaskPrincipal -UserId $owner.ownerSid -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Description "BLACKHOLE resident-v2 $($owner.installId)" | Out-Null
  }
  Start-Core
  Write-Output 'Local core passed authenticated readiness. Existing cloud/legacy data was not imported. Use status for phone readiness.'
}
function Get-PhoneConfig {
  $executable = $TailscalePath
  if (-not $executable) {
    $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($command) { $executable = $command.Source }
    elseif ($env:ProgramFiles -and (Test-Path -LiteralPath (Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'))) { $executable=Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe' }
  }
  if (-not $executable -or -not [IO.Path]::IsPathRooted($executable) -or -not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Install and sign in to Tailscale on PC and phone first. No account or tunnel was created.' }
  $probe = New-Object Diagnostics.Process
  $probe.StartInfo.FileName = $executable
  $probe.StartInfo.Arguments = 'status --json'
  $probe.StartInfo.UseShellExecute = $false
  $probe.StartInfo.CreateNoWindow = $true
  $probe.StartInfo.RedirectStandardOutput = $true
  $probe.StartInfo.RedirectStandardError = $true
  try {
    [void]$probe.Start()
    $stdout = $probe.StandardOutput.ReadToEndAsync()
    $stderr = $probe.StandardError.ReadToEndAsync()
    if (-not $probe.WaitForExit(7000)) { $probe.Kill(); throw 'Tailscale status timed out; no phone route was changed.' }
    $raw = $stdout.GetAwaiter().GetResult()
    $null = $stderr.GetAwaiter().GetResult()
    if ($probe.ExitCode -ne 0 -or $raw.Length -gt 262144) { throw 'Tailscale status is unavailable or oversized; no phone route was changed.' }
    try { $info = $raw | ConvertFrom-Json } catch { throw 'Tailscale returned invalid status JSON.' }
  } finally { $probe.Dispose() }
  $dns = ([string]$info.Self.DNSName).TrimEnd('.').ToLowerInvariant()
  if ($info.BackendState -ne 'Running' -or $dns -notmatch '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net$') { throw 'A connected Tailscale MagicDNS identity is required.' }
  return @{dnsName=$dns;executable=[IO.Path]::GetFullPath($executable)}
}
function Show-Status {
  $task = Get-OwnedTask
  $config = Get-Config
  $instance = Read-Json $InstancePath
  $healthy = Test-CoreHealth
  [ordered]@{taskName=$TaskName;taskState=$(if($task){[string]$task.State}else{'NotRegistered'});coreHealthy=$healthy;phoneStatus=$(if($healthy -and $instance.phone){$instance.phone.status}else{'unavailable'});phoneUrl=$(if($config.phone){"https://$($config.phone.dnsName):9443"}else{$null});dataDirectory=$DataDir;tokenFilePresent=(Test-Path -LiteralPath $TokenFile);instanceId=$(if($instance){$instance.instanceId}else{$null})} | ConvertTo-Json -Compress
}

if ($MyInvocation.InvocationName -eq '.') { return }
Assert-Paths
switch ($Action) {
  'install' { Install-Core }
  'start' { Start-Core; Show-Status }
  'stop' { Stop-Core; Show-Status }
  'restart' { Stop-Core; Start-Core; Show-Status }
  'status' { Show-Status }
  'uninstall' {
    Stop-Core
    if (Get-OwnedTask) { Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false }
    Write-Output 'Only the owned task was removed. Data and pairing key were preserved.'
  }
  'run' {
    $null = Get-OwnedTask; $null = Get-Config
    $node = Get-Node
    & $node (Join-Path $Root 'runtime\resident.mjs') --config $ConfigPath
    exit $LASTEXITCODE
  }
  'phone-install' {
    $config = Get-Config
    $phone = Get-PhoneConfig
    $instance = Read-Json $InstancePath
    if ($config.phone -and $config.phone.dnsName -eq $phone.dnsName -and $config.phone.executable -eq $phone.executable -and (Test-CoreHealth) -and $instance.phone.status -eq 'available' -and $instance.phone.verified -eq $true) { Show-Status; break }
    Stop-Core
    $config.phone = $phone
    Write-Json $ConfigPath $config
    Start-Core
    # The runtime checks Serve conflicts and probes HTTPS before reporting available.
    $until=[DateTime]::UtcNow.AddSeconds(25)
    do { $instance=Read-Json $InstancePath; if($instance.phone.status -in @('available','blocked','unavailable')){break}; Start-Sleep -Milliseconds 250 } while([DateTime]::UtcNow -lt $until)
    Show-Status
    if ($instance.phone.status -ne 'available') { throw 'Phone HTTPS is not verified. No existing Serve route was replaced. Local core remains available; inspect status or use phone-uninstall.' }
  }
  'phone-uninstall' {
    $config = Get-Config
    Stop-Core
    $config.phone = $null
    Write-Json $ConfigPath $config
    Start-Core
    Write-Output 'Owned foreground bridge stopped and core restarted without the phone host. No unrelated Serve configuration was reset.'
    Show-Status
  }
}
