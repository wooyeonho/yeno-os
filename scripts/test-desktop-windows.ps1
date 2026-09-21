# Real extracted portable package on disposable Windows runner. No owner/provider data.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:stage = 'extract'
$script:checks = New-Object 'System.Collections.Generic.List[string]'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('blackhole desktop ' + [Guid]::NewGuid().ToString('N'))
$package = Join-Path $testRoot 'package'
$desktopHome = Join-Path $testRoot 'private home'
$token = 'desktop-ci-' + [Guid]::NewGuid().ToString('N')
$deviceToken = ''
$script:setupToken = ''
$desktop = $null
$evidence = [ordered]@{
  schemaVersion=1; sourceCommit=$env:GITHUB_SHA; observedAt=[DateTime]::UtcNow.ToString('o')
  verification='REAL_WINDOWS_EXTRACTED_EXE_DPAPI_HTTP_RESTART'; status='running'
  liveProvider='not_run'; physicalAndroid='not_run'; liveTailscale='not_run'; productionChanges=$false
}
function Assert-That([bool]$Condition,[string]$Label) {
  if (-not $Condition) { throw ('Assertion failed: ' + $Label) }
  $script:checks.Add($Label)
}
function Bytes-Hash([byte[]]$Bytes) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Start-Native([string]$Arguments) {
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=Join-Path $package 'BLACKHOLE.exe'; $info.Arguments=$Arguments
  $info.WorkingDirectory=$package; $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $info.RedirectStandardInput=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  $info.StandardOutputEncoding=New-Object Text.UTF8Encoding($false)
  $info.EnvironmentVariables['BLACKHOLE_DESKTOP_HOME']=$desktopHome
  $process=New-Object Diagnostics.Process
  $process.StartInfo=$info
  $null=$process.Start()
  return $process
}
function Invoke-Helper([string]$Arguments,[string]$InputText='') {
  $process=Start-Native $Arguments
  try {
    $output=$process.StandardOutput.ReadToEndAsync(); $errorOutput=$process.StandardError.ReadToEndAsync()
    if ($InputText) { $process.StandardInput.WriteLine($InputText) }
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(10000)) { throw 'Native helper timeout.' }
    return @{code=$process.ExitCode; output=$output.GetAwaiter().GetResult().Trim(); error=$errorOutput.GetAwaiter().GetResult().Trim()}
  } finally { $process.Dispose() }
}
function Start-Desktop {
  $process=Start-Native '--smoke'
  $errorOutput=$process.StandardError.ReadToEndAsync()
  $deadline=[DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    $line=$process.StandardOutput.ReadLineAsync()
    while (-not $line.IsCompleted -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
    if (-not $line.IsCompleted) { break }
    $value=$line.GetAwaiter().GetResult()
    if ($null -eq $value) { break }
    if ($value.Length -gt 65536) { throw 'Unbounded launcher protocol.' }
    try { $message=$value | ConvertFrom-Json } catch { continue }
    if ($message.type -eq 'ready') {
      $uri=[Uri]$message.url
      Assert-That ($uri.Scheme -eq 'http' -and $uri.Host -eq '127.0.0.1') 'setup binds loopback only'
      Assert-That ($uri.Fragment.StartsWith('#setup=')) 'one-time setup access in fragment only'
      $script:setupOrigin=$uri.GetLeftPart([UriPartial]::Authority)
      $script:setupToken=[Uri]::UnescapeDataString($uri.Fragment.Substring(7))
      return @{process=$process; errorTask=$errorOutput; status=$message.status}
    }
  }
  if (-not $process.HasExited) { $process.StandardInput.WriteLine('STOP'); $process.StandardInput.Flush(); $null=$process.WaitForExit(10000) }
  throw 'Compiled desktop did not become ready.'
}
function Stop-Desktop($Handle) {
  if ($null -eq $Handle) { return }
  $process=$Handle.process
  if (-not $process.HasExited) {
    $process.StandardInput.WriteLine('STOP'); $process.StandardInput.Flush()
    if (-not $process.WaitForExit(20000)) { throw 'Desktop did not stop gracefully.' }
  }
  Assert-That ($process.ExitCode -eq 0) 'native launcher gracefully exits after STOP'
  $errors=$Handle.errorTask.GetAwaiter().GetResult()
  Assert-That (-not $errors.Contains($token) -and -not $errors.Contains($script:setupToken)) 'no secrets in native diagnostic output'
  $process.Dispose()
}
function Request([string]$Origin,[string]$Method,[string]$Route,[hashtable]$Headers=@{},$Body=$null) {
  $parameters=@{Uri=($Origin+$Route); Method=$Method; Headers=$Headers; TimeoutSec=8; UseBasicParsing=$true}
  if ($null -ne $Body) { $parameters.ContentType='application/json'; $parameters.Body=[Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 15 -Compress)) }
  try {
    $response=Invoke-WebRequest @parameters
    $json=$null
    if ($response.Headers['Content-Type'] -like 'application/json*') { $json=$response.Content | ConvertFrom-Json }
    return @{status=[int]$response.StatusCode; json=$json; bytes=$response.RawContentStream.ToArray(); headers=$response.Headers}
  } catch {
    if ($_.Exception.PSObject.Properties['Response'] -and $null -ne $_.Exception.Response) { return @{status=[int]$_.Exception.Response.StatusCode; json=$null; bytes=@(); headers=@{}} }
    return @{status=0; json=$null; bytes=@(); headers=@{}}
  }
}
function Request-Core([string]$Method,[string]$Route,[string]$Credential,$Body=$null) {
  $headers=@{Authorization=('Bearer '+$Credential)}
  if ($Route.StartsWith('/api/v1/')) { $headers.Origin='http://tauri.localhost' }
  return Request $script:coreOrigin $Method $Route $headers $Body
}

try {
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($Archive,$package)
  Assert-That ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) 'real Windows runner'
  $manifest=Get-Content -LiteralPath (Join-Path $package 'BUILD.json') -Raw | ConvertFrom-Json
  Assert-That ($manifest.sourceSha -eq $env:GITHUB_SHA) 'package exact source SHA'
  Assert-That (-not $manifest.launcherSigned) 'unsigned launcher disclosed honestly'
  Assert-That ((Get-AuthenticodeSignature -FilePath (Join-Path $package 'node.exe')).Status -eq 'Valid') 'bundled Node publisher signature retained'
  Assert-That (Test-Path -LiteralPath (Join-Path $package 'NODE_LICENSE.txt')) 'Node license retained'
  $dependencies=@(Get-ChildItem -LiteralPath (Join-Path $package 'runtime/node_modules') -Recurse -File | Where-Object {$_.Name -match '^LICENSE'})
  Assert-That ($dependencies.Count -ge 1) 'runtime dependency licenses retained'
  $hashCount=0
  foreach ($line in Get-Content -LiteralPath (Join-Path $package 'SHA256SUMS.txt')) {
    if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Malformed package hash manifest.' }
    $expected=$Matches[1]; $relative=$Matches[2]
    $actual=(Get-FileHash -LiteralPath (Join-Path $package $relative) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw 'Package hash mismatch.' }
    $hashCount++
  }
  Assert-That ($hashCount -gt 50) 'all packaged file hashes verified after extraction'
  $evidence.packageFileCount=$hashCount
  $evidence.archiveSha256=(Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  $evidence.exeSha256=(Get-FileHash -LiteralPath (Join-Path $package 'BLACKHOLE.exe') -Algorithm SHA256).Hash.ToLowerInvariant()

  $script:stage='native_crypto'
  $plain=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($token))
  $protected=Invoke-Helper '--protect' $plain
  if ($protected.code -ne 0 -or -not $protected.output) {
    $helperError='unclassified'
    if ($protected.error -match 'BLACKHOLE_LAUNCHER_FAILED:[a-z_]+:[A-Za-z0-9]+:0x[A-F0-9]{8}') { $helperError=$Matches[0] }
    $evidence.nativeHelperFailure=@{exitCode=$protected.code;outputLength=$protected.output.Length;category=$helperError}
    Write-Warning ($evidence.nativeHelperFailure | ConvertTo-Json -Compress)
  }
  Assert-That ($protected.code -eq 0 -and $protected.output -ne $plain) 'compiled DPAPI encrypts CurrentUser data'
  $unprotected=Invoke-Helper '--unprotect' $protected.output
  Assert-That ($unprotected.code -eq 0 -and $unprotected.output -ceq $plain) 'compiled DPAPI exact readback'
  $corrupt=Invoke-Helper '--unprotect' ([Convert]::ToBase64String([byte[]](1,2,3,4)))
  Assert-That ($corrupt.code -ne 0 -and -not $corrupt.error.Contains($token)) 'invalid encrypted data fails closed without secret output'

  $script:stage='native_acl'
  $aclPath=Join-Path $testRoot 'acl-check'
  $secured=Invoke-Helper ('--secure-directory "'+$aclPath+'"')
  Assert-That ($secured.code -eq 0) 'compiled native directory protection runs'
  $acl=Get-Acl -LiteralPath $aclPath
  $ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  Assert-That ($acl.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $ownerSid) 'desktop directory owner-only ACL'
  $junction=Join-Path $testRoot 'junction'
  $null=New-Item -ItemType Junction -Path $junction -Target $aclPath
  $blocked=Invoke-Helper ('--secure-directory "'+(Join-Path $junction 'blocked')+'"')
  Assert-That ($blocked.code -ne 0 -and -not (Test-Path -LiteralPath (Join-Path $aclPath 'blocked'))) 'reparse ancestor blocked without write'

  $script:stage='compiled_exe_setup'
  $desktop=Start-Desktop
  Assert-That ($desktop.status -eq 'setup-required') 'new desktop requires explicit setup'
  $unauth=Request $script:setupOrigin 'GET' '/setup/state'
  Assert-That ($unauth.status -eq 401 -or $unauth.status -eq 403) 'setup rejects missing nonce'
  $setupHeaders=@{'X-Blackhole-Setup'=$script:setupToken; Origin=$script:setupOrigin}
  $setup=Request $script:setupOrigin 'GET' '/setup/state' $setupHeaders
  Assert-That ($setup.status -eq 200) 'local owner setup state readable'
  $init=Request $script:setupOrigin 'POST' '/setup/initialize' $setupHeaders @{
    pairingKey=$token; confirmNewStore=$true
    providers=@{version=1; providers=@(); primaryProvider=$null; dailyCallLimit=5}
  }
  if ($init.status -ne 201) { throw ('Desktop initialize HTTP status: '+$init.status) }
  Assert-That $init.json.ok 'new store initialized by owner confirmation'
  $script:coreOrigin=$init.json.coreUrl
  Assert-That (([Uri]$script:coreOrigin).Host -eq '127.0.0.1') 'personal core stays loopback only'
  Assert-That ((Request-Core 'GET' '/api/state' 'wrong-key').status -eq 401) 'core rejects incorrect owner key'
  Assert-That ((Request-Core 'GET' '/api/state' $token).status -eq 200) 'compiled package serves authenticated core'
  $files=@(Get-ChildItem -LiteralPath $desktopHome -Recurse -File)
  $leaked=@($files | Where-Object { [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($_.FullName)).Contains($token) })
  Assert-That ($leaked.Count -eq 0) 'pairing key not stored as plaintext'

  $script:stage='native_api_real_result'
  $enrollment=Request-Core 'POST' '/api/v1/devices/enroll' $token @{name='Desktop CI phone contract';platform='android';requestId=[Guid]::NewGuid().ToString()}
  Assert-That ($enrollment.status -eq 201) 'phone contract device enrollment'
  $deviceToken=$enrollment.json.device.deviceToken
  $commandBody=@{text='document: BLACKHOLE desktop result from compiled executable';requestId=[Guid]::NewGuid().ToString()}
  $command=Request-Core 'POST' '/api/v1/commands' $deviceToken $commandBody
  Assert-That ($command.status -eq 201) 'document submitted through actual packaged core'
  $jobId=$command.json.job.id
  $job=$null
  for ($attempt=0;$attempt -lt 100;$attempt++) {
    $state=Request-Core 'GET' '/api/v1/state' $deviceToken
    if ($state.status -ne 200) { throw 'Cannot read native job state.' }
    $matches=@($state.json.jobs | Where-Object {$_.id -eq $jobId})
    if ($matches.Count -eq 1) { $job=$matches[0]; if ($job.status -in @('completed','failed','cancelled')) { break } }
    Start-Sleep -Milliseconds 150
  }
  Assert-That ($null -ne $job -and $job.status -eq 'completed' -and $job.artifacts.Count -gt 0) 'real document job produces persisted artifact'
  $artifactId=$job.artifacts[0].id
  $artifact=Request-Core 'GET' ('/api/v1/artifacts/'+$artifactId) $deviceToken
  $artifactHash=Bytes-Hash $artifact.bytes
  Assert-That ($artifact.status -eq 200 -and $artifact.bytes.Length -gt 0 -and $artifactHash -eq $artifact.headers['X-Content-SHA256']) 'downloaded artifact bytes match recorded hash'
  $evidence.resultArtifactSha256=$artifactHash

  $script:stage='restart_and_replay'
  Stop-Desktop $desktop; $desktop=$null
  Assert-That ((Request-Core 'GET' '/api/state' $token).status -eq 0) 'STOP releases owned HTTP core'
  $desktop=Start-Desktop
  Assert-That ($desktop.status -eq 'locked') 'restart restores encrypted configuration without exposing settings'
  $restored=Request-Core 'GET' '/api/v1/state' $deviceToken
  Assert-That ($restored.status -eq 200) 'same device credential works after EXE restart'
  $jobs=@($restored.json.jobs | Where-Object {$_.id -eq $jobId})
  Assert-That ($jobs.Count -eq 1 -and $jobs[0].status -eq 'completed') 'one original completed job after restart'
  $replayed=Request-Core 'POST' '/api/v1/commands' $deviceToken $commandBody
  Assert-That ($replayed.status -eq 201 -and $replayed.json.job.id -eq $jobId) 'same request ID does not duplicate work after restart'
  $again=Request-Core 'GET' ('/api/v1/artifacts/'+$artifactId) $deviceToken
  Assert-That ($again.status -eq 200 -and (Bytes-Hash $again.bytes) -eq $artifactHash) 'same exact artifact after restart'

  $script:stage='emergency_stop'
  $stop=Request-Core 'POST' '/api/v1/control' $deviceToken @{action='stop';requestId=[Guid]::NewGuid().ToString()}
  Assert-That ($stop.status -eq 200) 'emergency stop acknowledged'
  $blocked=Request-Core 'POST' '/api/v1/commands' $deviceToken @{text='document: must not execute';requestId=[Guid]::NewGuid().ToString()}
  Assert-That ($blocked.status -eq 409) 'emergency stop blocks execution'
  Stop-Desktop $desktop; $desktop=$null
  $desktop=Start-Desktop
  $state=Request-Core 'GET' '/api/v1/state' $deviceToken
  Assert-That ($state.status -eq 200 -and $state.json.emergencyStop -eq $true) 'emergency stop persists across actual EXE restart'
  Stop-Desktop $desktop; $desktop=$null
  Assert-That (Test-Path -LiteralPath (Join-Path $desktopHome 'data/state.json')) 'application exit preserves durable owner state'
  $evidence.status='passed'
  Write-Output ('Windows desktop acceptance passed: '+$script:checks.Count+' checks. No physical phone/live provider claim.')
} catch {
  $failure=$_
  $evidence.status='failed';$evidence.failedStage=$script:stage
  $message=$failure.Exception.Message
  foreach ($secret in @($token,$deviceToken,$script:setupToken)) { if ($secret) { $message=$message.Replace($secret,'[REDACTED]') } }
  $evidence.failure=@{type=$failure.Exception.GetType().FullName; message=$message; line=$failure.InvocationInfo.ScriptLineNumber}
  Write-Warning ($evidence.failure | ConvertTo-Json -Compress)
  throw ('Windows desktop acceptance failed at stage '+$script:stage)
} finally {
  if ($null -ne $desktop) { try { Stop-Desktop $desktop } catch { Write-Warning 'Disposable runner desktop cleanup pending.' } }
  $evidence.checks=@($script:checks);$evidence.checkCount=$script:checks.Count
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EvidencePath) | Out-Null
  $evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
  # Synthetic credentials and state remain solely on the disposable runner.
}
