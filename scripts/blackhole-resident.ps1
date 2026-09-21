# BLACKHOLE resident Windows launcher
# Runs the existing runtime/service.mjs under the current Windows user.
# It does not create a second scheduler, provider, or job engine.

[CmdletBinding()]
param(
  [ValidateSet('install', 'uninstall', 'status', 'run')]
  [string]$Action = 'run',
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [switch]$RemoveSecret
)

$ErrorActionPreference = 'Stop'
$TaskName = 'BLACKHOLE Core'
$RuntimeDir = Join-Path $Root 'runtime'
$DataDir = Join-Path $env:LOCALAPPDATA 'BLACKHOLE\data'
$SecretDir = Join-Path $env:LOCALAPPDATA 'BLACKHOLE\secrets'
$TokenFile = Join-Path $SecretDir 'pairing.token'
$ScriptPath = Join-Path $PSScriptRoot 'blackhole-resident.ps1'

function Assert-Node20 {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw 'Node.js 20 or newer is required. Install the current Node.js LTS, then run this command again.'
  }
  $version = (& $node.Source --version 2>$null | Select-Object -First 1)
  $match = [regex]::Match([string]$version, '^v?(\d+)')
  if (-not $match.Success -or [int]$match.Groups[1].Value -lt 20) {
    throw "Node.js 20 or newer is required; found '$version'."
  }
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Protect-TokenFile([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path
  # The token is a local secret. Remove inherited/other entries and grant only
  # the account that installed the task. The token value is never printed.
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($entry in @($acl.Access)) {
    [void]$acl.RemoveAccessRule($entry)
  }
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
  [void]$acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Ensure-Token {
  Ensure-Directory $SecretDir
  if (Test-Path -LiteralPath $TokenFile -PathType Leaf) {
    $existing = [System.IO.File]::ReadAllText($TokenFile)
    if ($existing.Length -lt 16 -or $existing -match '[\r\n]') {
      throw "The token file '$TokenFile' is invalid. It must contain one line of at least 16 characters."
    }
    Protect-TokenFile $TokenFile
    return
  }

  $token = Read-Host 'BLACKHOLE pairing token (16+ characters; never paste it into chat)'
  if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 16 -or $token -match '[\r\n]') {
    throw 'The pairing token must be one line and at least 16 characters.'
  }
  [System.IO.File]::WriteAllText($TokenFile, $token, (New-Object System.Text.UTF8Encoding($false)))
  Protect-TokenFile $TokenFile
}

function Get-TaskPrincipal {
  return [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
}

function Register-ResidentTask {
  $current = Get-TaskPrincipal
  $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
  $safeScript = $ScriptPath.Replace('"', '\"')
  $safeRoot = $Root.Replace('"', '\"')
  $arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$safeScript`" -Action run -Root `"$safeRoot`""

  $taskAction = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
  $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $current
  $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId $current -LogonType InteractiveToken -RunLevel Limited

  Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $taskPrincipal -Description 'BLACKHOLE persistent core (existing runtime/service.mjs; one instance)' -Force | Out-Null
}

function Run-Core {
  Assert-Node20
  if (-not (Test-Path -LiteralPath $RuntimeDir -PathType Container)) {
    throw "Runtime directory not found: $RuntimeDir"
  }
  if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
    throw "Token file not found: $TokenFile. Run -Action install once in an interactive PowerShell."
  }
  Ensure-Directory $DataDir
  # The service entrypoint reads the token file and never prints its value.
  $env:YENO_TOKEN_FILE = $TokenFile
  $env:YENO_DATA_DIR = $DataDir
  # Loopback is intentional. Remote/phone access is a separate, owner-configured
  # tunnel (for example Tailscale Serve) and is not silently opened here.
  $env:YENO_HOST = '127.0.0.1'
  if (-not $env:YENO_PORT) { $env:YENO_PORT = '8790' }

  Push-Location $RuntimeDir
  try {
    & $node.Source service.mjs
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  exit $exitCode
}

function Show-ResidentStatus {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $info = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue } else { $null }
  [pscustomobject]@{
    taskName = $TaskName
    taskState = if ($task) { [string]$task.State } else { 'NotRegistered' }
    lastRunTime = if ($info) { $info.LastRunTime } else { $null }
    lastTaskResult = if ($info) { $info.LastTaskResult } else { $null }
    nextRunTime = if ($info) { $info.NextRunTime } else { $null }
    tokenFilePresent = Test-Path -LiteralPath $TokenFile -PathType Leaf
    dataDirectory = $DataDir
    dataDirectoryPresent = Test-Path -LiteralPath $DataDir -PathType Container
    networkBinding = '127.0.0.1'
  } | Format-List
}

function Uninstall-ResidentTask {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  if ($RemoveSecret -and (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
    Remove-Item -LiteralPath $TokenFile -Force
    Write-Output 'Pairing token removed. Runtime data was preserved.'
  } else {
    Write-Output 'Scheduled task removed. Pairing token and runtime data were preserved.'
  }
}

switch ($Action) {
  'install' {
    Assert-Node20
    Ensure-Directory $DataDir
    Ensure-Token
    Register-ResidentTask
    Start-ScheduledTask -TaskName $TaskName
    Write-Output "BLACKHOLE resident core installed for the current Windows user."
    Write-Output "Task: $TaskName"
    Write-Output "Data: $DataDir"
    Write-Output 'Binding: 127.0.0.1 (remote access is not opened automatically).'
  }
  'uninstall' { Uninstall-ResidentTask }
  'status' { Show-ResidentStatus }
  'run' { Run-Core }
}
