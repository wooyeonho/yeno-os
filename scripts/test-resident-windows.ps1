# Runs on an isolated Windows CI host. No production data, live Tailscale,
# provider keys, Android device or paid service is used by this acceptance.
[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [Parameter(Mandatory = $true)][string]$EvidencePath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:stage = 'preflight'
$script:checks = New-Object 'System.Collections.Generic.List[string]'
$script:allOutput = ''
$testId = [Guid]::NewGuid().ToString('N')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('blackhole resident test ' + $testId)
$residentHome = Join-Path $testRoot 'resident home'
$collisionHome = Join-Path $testRoot 'collision home'
$taskName = 'BLACKHOLE CI ' + $testId
$collisionTaskName = 'BLACKHOLE CI collision ' + $testId
$launcher = Join-Path $Root 'scripts/blackhole-resident.ps1'
$token = 'resident-ci-' + [Guid]::NewGuid().ToString('N')
$secureToken = ConvertTo-SecureString -String $token -AsPlainText -Force
$evidence = [ordered]@{
    schemaVersion = 1
    sourceCommit = $env:GITHUB_SHA
    verification = 'WINDOWS_CI_REAL_PROCESS_AND_SCHEDULER'
    observedAt = [DateTime]::UtcNow.ToString('o')
    status = 'running'
    checks = @()
    liveTailscale = 'not_run'
    physicalAndroid = 'not_run'
    liveProvider = 'not_run'
    productionChanges = $false
}

function Assert-That([bool]$Condition, [string]$Label) {
    if (-not $Condition) { throw ('Assertion failed: ' + $Label) }
    $script:checks.Add($Label)
}
function Run-Launcher([string]$Action, [hashtable]$Extra = @{}) {
    $parameters = @{ Action = $Action; Root = $Root; HomeDir = $residentHome; TaskName = $taskName }
    foreach ($entry in $Extra.GetEnumerator()) { $parameters[$entry.Key] = $entry.Value }
    $global:LASTEXITCODE = 0
    $output = (& $launcher @parameters 6>&1 | Out-String)
    if (-not $? -or $LASTEXITCODE -ne 0) { throw ('Launcher failed: ' + $Action) }
    $script:allOutput += $output
    Assert-That (-not $output.Contains($token)) ('no secret in ' + $Action + ' output')
    return $output
}
function Request-Core([string]$Method, [string]$Route, [string]$Credential, $Body = $null) {
    $headers = @{}
    if ($Route.StartsWith('/api/v1/')) { $headers.Origin = 'http://tauri.localhost' }
    if ($Credential) { $headers.Authorization = 'Bearer ' + $Credential }
    $parameters = @{ Uri = ($script:baseUrl + $Route); Method = $Method; Headers = $headers; TimeoutSec = 5; UseBasicParsing = $true }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json; charset=utf-8'
        $parameters.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 12 -Compress))
    }
    try {
        $response = Invoke-WebRequest @parameters
        $json = $null
        if ($response.Headers['Content-Type'] -like 'application/json*') { $json = $response.Content | ConvertFrom-Json }
        return @{ status = [int]$response.StatusCode; json = $json; bytes = $response.RawContentStream.ToArray(); headers = $response.Headers }
    } catch {
        if ($_.Exception.PSObject.Properties['Response'] -and $null -ne $_.Exception.Response) { return @{ status = [int]$_.Exception.Response.StatusCode; json = $null; bytes = @(); headers = @{} } }
        return @{ status = 0; json = $null; bytes = @(); headers = @{} }
    }
}
function Wait-Core([bool]$ExpectedUp) {
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        $response = Request-Core 'GET' '/api/state' $token
        if (($response.status -eq 200) -eq $ExpectedUp) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'Core did not reach expected readiness state.'
}
function Assert-PrivateAcl([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    $isDirectory = (Get-Item -LiteralPath $Path).PSIsContainer
    if ($isDirectory) { Assert-That $acl.AreAccessRulesProtected ('protected directory ACL: ' + [IO.Path]::GetFileName($Path)) }
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    Assert-That ($rules.Count -gt 0) ('nonempty ACL: ' + [IO.Path]::GetFileName($Path))
    foreach ($rule in $rules) {
        Assert-That ($rule.IdentityReference.Value -eq $currentSid -and $rule.AccessControlType -eq 'Allow') ('effective owner-only ACL: ' + [IO.Path]::GetFileName($Path))
        if ($isDirectory) { Assert-That (-not $rule.IsInherited) ('no inherited directory grants: ' + [IO.Path]::GetFileName($Path)) }
    }
}
function Bytes-Hash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Redact-Diagnostic([string]$Text) {
    if ($null -eq $Text) { return '' }
    $safe = $Text
    foreach ($name in @('token', 'deviceToken')) {
        $value = Get-Variable -Name $name -Scope Script -ErrorAction SilentlyContinue
        if ($value -and $value.Value -is [string] -and $value.Value.Length -gt 0) {
            $safe = $safe.Replace($value.Value, '[REDACTED]')
        }
    }
    $safe = $safe -replace '(?i)Bearer\s+\S+', 'Bearer [REDACTED]'
    $safe = $safe -replace '(?i)(api[_-]?key|password|authorization|token)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]'
    if ($safe.Length -gt 1000) { $safe = $safe.Substring(0, 1000) }
    return $safe
}

try {
    Assert-That ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1) 'real Windows PowerShell 5.1'
    Assert-That ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) 'real Windows host'
    $script:stage = 'powershell_ast'
    $parseFiles = @(Get-ChildItem -LiteralPath (Join-Path $Root 'scripts') -Filter '*.ps1' -Recurse -File)
    Assert-That ($parseFiles.Count -ge 2) 'PowerShell files discovered'
    foreach ($file in $parseFiles) {
        $parseTokens = $null; $parseErrors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$parseTokens, [ref]$parseErrors)
        Assert-That (@($parseErrors).Count -eq 0) ('AST parse: ' + $file.Name)
        if ($file.FullName -eq $launcher) {
            $functionNames = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
            $duplicateNames = @($functionNames | Group-Object | Where-Object { $_.Count -gt 1 })
            Assert-That ($duplicateNames.Count -eq 0) 'no duplicate launcher functions'
        }
    }

    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $listener = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0
    $listener.Start()
    $testPort = $listener.LocalEndpoint.Port
    $listener.Stop()
    $script:baseUrl = 'http://127.0.0.1:' + $testPort

    $script:stage = 'first_install_requires_explicit_new_store'
    $refused = $false
    try { $null = Run-Launcher 'install' @{ Port = $testPort; PairingToken = $secureToken } } catch { $refused = $true }
    Assert-That $refused 'first install requires explicit InitializeNewStore'

    $script:stage = 'existing_store_refusal'
    $legacyHome = Join-Path $testRoot 'existing store'
    $legacyData = Join-Path $legacyHome 'data'
    New-Item -ItemType Directory -Path $legacyData -Force | Out-Null
    $legacyState = Join-Path $legacyData 'state.json'
    'synthetic legacy sentinel, do not migrate' | Set-Content -LiteralPath $legacyState -Encoding UTF8
    $legacyHash = (Get-FileHash -LiteralPath $legacyState -Algorithm SHA256).Hash
    $refused = $false
    try { $null = Run-Launcher 'install' @{ HomeDir = $legacyHome; Port = $testPort; InitializeNewStore = $true; PairingToken = $secureToken } } catch { $refused = $true }
    Assert-That $refused 'unconfigured existing store is refused even with new-store flag'
    Assert-That ((Get-FileHash -LiteralPath $legacyState -Algorithm SHA256).Hash -eq $legacyHash) 'existing state is not migrated or overwritten'

    $script:stage = 'install_real_task'
    $null = Run-Launcher 'install' @{ Port = $testPort; InitializeNewStore = $true; PairingToken = $secureToken }
    $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\'
    [xml]$taskXml = Export-ScheduledTask -TaskName $taskName -TaskPath '\'
    Assert-That ($taskXml.Task.Principals.Principal.LogonType -eq 'InteractiveToken') 'task uses current interactive owner'
    Assert-That ($taskXml.Task.Settings.ExecutionTimeLimit -eq 'PT0S') 'task has no default 72-hour expiry'
    Assert-That ([int]$taskXml.Task.Settings.RestartOnFailure.Count -ge 1 -and [int]$taskXml.Task.Settings.RestartOnFailure.Count -le 5) 'bounded scheduler retry'
    Assert-That (($task.Actions | Out-String) -notmatch 'service\.mjs') 'task does not launch Linux container entrypoint'
    $configPath = Join-Path $residentHome 'config.json'
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    Assert-That ($config.version -eq 1 -and $config.port -eq $testPort -and $null -eq $config.phone) 'one local configuration, phone disabled by default'
    foreach ($privatePath in @($residentHome, $configPath, $config.dataDir, (Split-Path -Parent $config.tokenFile), $config.tokenFile)) { Assert-PrivateAcl $privatePath }
    $tokenHash = (Get-FileHash -LiteralPath $config.tokenFile -Algorithm SHA256).Hash
    $ownerBefore = Get-Content -Raw -LiteralPath (Join-Path $residentHome 'owner.json')

    $script:stage = 'start_and_native_enrollment'
    $null = Run-Launcher 'start'
    Wait-Core $true
    $status = (Run-Launcher 'status') | ConvertFrom-Json
    Assert-That ($status.coreHealthy -eq $true) 'status checks real authenticated HTTP readiness'
    Assert-That ($status.phoneStatus -ne 'available') 'no unconfigured phone availability claim'
    Assert-That ((Request-Core 'GET' '/api/state' 'invalid-ci-token').status -eq 401) 'incorrect owner credential rejected'
    $enrollment = Request-Core 'POST' '/api/v1/devices/enroll' $token @{ name = 'Windows CI native contract'; platform = 'android'; requestId = [Guid]::NewGuid().ToString() }
    Assert-That ($enrollment.status -eq 201) 'native device enrolled against scheduled core'
    $deviceToken = $enrollment.json.device.deviceToken
    $body = @{ text = 'document: Windows resident acceptance artifact'; requestId = [Guid]::NewGuid().ToString() }
    $command = Request-Core 'POST' '/api/v1/commands' $deviceToken $body
    Assert-That ($command.status -eq 201) 'native document command accepted'
    $jobId = $command.json.job.id
    $job = $null
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $state = Request-Core 'GET' '/api/v1/state' $deviceToken
        Assert-That ($state.status -eq 200) 'native state query succeeds'
        $job = @($state.json.jobs | Where-Object { $_.id -eq $jobId })[0]
        if ($job.status -eq 'completed') { break }
        if ($job.status -in @('failed', 'cancelled')) { throw 'Document did not complete.' }
        Start-Sleep -Milliseconds 150
    }
    Assert-That ($job.status -eq 'completed' -and $job.artifacts.Count -gt 0) 'real document artifact produced'
    $artifactId = $job.artifacts[0].id
    $artifact = Request-Core 'GET' ('/api/v1/artifacts/' + $artifactId) $deviceToken
    Assert-That ($artifact.status -eq 200 -and $artifact.bytes.Length -gt 0) 'native result bytes downloaded'
    $artifactHash = Bytes-Hash $artifact.bytes
    Assert-That ($artifactHash -eq $artifact.headers['X-Content-SHA256']) 'downloaded bytes match recorded artifact SHA256'

    $script:stage = 'idempotent_install'
    $null = Run-Launcher 'install'
    Assert-That ((Get-FileHash -LiteralPath $config.tokenFile -Algorithm SHA256).Hash -eq $tokenHash) 'reinstall does not rotate pairing key'
    Assert-That ((Get-Content -Raw -LiteralPath (Join-Path $residentHome 'owner.json')) -ceq $ownerBefore) 'reinstall preserves installation identity'

    $script:stage = 'stop_restart_reconnect'
    $null = Run-Launcher 'stop'
    Wait-Core $false
    Assert-That (-not (Test-Path -LiteralPath (Join-Path $config.dataDir 'runtime.lock'))) 'graceful stop releases store lease'
    $null = Run-Launcher 'start'
    Wait-Core $true
    $restored = Request-Core 'GET' '/api/v1/state' $deviceToken
    Assert-That ($restored.status -eq 200) 'same native credential survives restart'
    $restoredJob = @($restored.json.jobs | Where-Object { $_.id -eq $jobId })
    Assert-That ($restoredJob.Count -eq 1 -and $restoredJob[0].status -eq 'completed') 'same completed job survives restart without duplicate'
    $replay = Request-Core 'POST' '/api/v1/commands' $deviceToken $body
    Assert-That ($replay.status -eq 201 -and $replay.json.job.id -eq $jobId) 'same requestId returns original job after restart'
    $artifactAgain = Request-Core 'GET' ('/api/v1/artifacts/' + $artifactId) $deviceToken
    Assert-That ($artifactAgain.status -eq 200 -and (Bytes-Hash $artifactAgain.bytes) -eq $artifactHash) 'same artifact hash after reconnect'
    $null = Run-Launcher 'restart'
    Wait-Core $true
    Assert-That ((Request-Core 'GET' '/api/v1/state' $deviceToken).status -eq 200) 'restart command preserves device enrollment'

    $script:stage = 'emergency_stop'
    $stopped = Request-Core 'POST' '/api/v1/control' $deviceToken @{ action = 'stop'; requestId = [Guid]::NewGuid().ToString() }
    Assert-That ($stopped.status -eq 200) 'native emergency stop acknowledged'
    $blocked = Request-Core 'POST' '/api/v1/commands' $deviceToken @{ text = 'document: forbidden during emergency stop'; requestId = [Guid]::NewGuid().ToString() }
    Assert-That ($blocked.status -eq 409) 'emergency stop refuses new document execution'
    $null = Run-Launcher 'restart'
    Wait-Core $true
    $stoppedState = Request-Core 'GET' '/api/v1/state' $deviceToken
    Assert-That ($stoppedState.json.emergencyStop -eq $true) 'emergency stop survives resident restart'

    $script:stage = 'unowned_task_refusal'
    $collisionAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -Command exit 0'
    $collisionPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $collisionTaskName -TaskPath '\' -Action $collisionAction -Principal $collisionPrincipal -Description ('BLACKHOLE resident-v2 ' + $testId) | Out-Null
    $collisionBefore = Export-ScheduledTask -TaskName $collisionTaskName -TaskPath '\'
    $refused = $false
    try { $null = Run-Launcher 'install' @{ TaskName = $collisionTaskName; HomeDir = $collisionHome; Port = $testPort; InitializeNewStore = $true; PairingToken = $secureToken } } catch { $refused = $true }
    Assert-That $refused 'unowned existing task is refused'
    Assert-That ((Export-ScheduledTask -TaskName $collisionTaskName -TaskPath '\') -ceq $collisionBefore) 'unowned task XML remains unchanged'
    # Even a matching owner file is not authority to mutate a different task.
    New-Item -ItemType Directory -Force -Path $collisionHome | Out-Null
    $collisionOwner = Get-Content -Raw -LiteralPath (Join-Path $residentHome 'owner.json') | ConvertFrom-Json
    $collisionOwner.taskName = $collisionTaskName
    $collisionOwner.installId = $testId
    $collisionOwner | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $collisionHome 'owner.json') -Encoding UTF8
    $refused = $false
    try { $null = Run-Launcher 'uninstall' @{ TaskName = $collisionTaskName; HomeDir = $collisionHome } } catch { $refused = $true }
    Assert-That $refused 'matching owner file cannot authorize uninstall of different task action'
    Assert-That ((Export-ScheduledTask -TaskName $collisionTaskName -TaskPath '\') -ceq $collisionBefore) 'refused uninstall preserves foreign task'

    $script:stage = 'uninstall_preserves_data'
    $null = Run-Launcher 'uninstall'
    Wait-Core $false
    Assert-That ($null -eq (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue)) 'owned scheduled task removed'
    Assert-That (Test-Path -LiteralPath (Join-Path $config.dataDir 'state.json')) 'uninstall preserves durable state'
    $diskEnvelope = Get-Content -Raw -LiteralPath (Join-Path $config.dataDir 'state.json') | ConvertFrom-Json
    $diskState = $diskEnvelope.payload | ConvertFrom-Json
    Assert-That (@($diskState.jobs | Where-Object { $_.id -eq $jobId }).Count -eq 1) 'uninstall preserves original job identity'
    $diskArtifact = $diskState.artifacts.PSObject.Properties[$artifactId].Value
    $diskArtifactPath = Join-Path (Join-Path $config.dataDir 'artifacts') $diskArtifact.filename
    Assert-That ((Get-FileHash -LiteralPath $diskArtifactPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $artifactHash) 'uninstall preserves exact artifact bytes'
    Assert-That ((Get-FileHash -LiteralPath $config.tokenFile -Algorithm SHA256).Hash -eq $tokenHash) 'uninstall preserves pairing key'
    Assert-That (-not $script:allOutput.Contains($token) -and -not $script:allOutput.Contains($deviceToken)) 'launcher output never discloses credentials'
    $evidence.artifactSha256 = $artifactHash
    $evidence.status = 'passed'
    $evidence.checks = @($script:checks)
    $evidence.checkCount = $script:checks.Count
    Write-Output ('Windows resident acceptance passed: ' + $script:checks.Count + ' assertions; physical phone/Tailscale pending.')
} catch {
    $failure = $_
    $evidence.status = 'failed'
    $evidence.failedStage = $script:stage
    $evidence.checks = @($script:checks)
    $evidence.checkCount = $script:checks.Count
    $evidence.failure = [ordered]@{
        type = Redact-Diagnostic $failure.Exception.GetType().FullName
        fullyQualifiedErrorId = Redact-Diagnostic $failure.FullyQualifiedErrorId
        sourceFile = [IO.Path]::GetFileName($failure.InvocationInfo.ScriptName)
        lineNumber = $failure.InvocationInfo.ScriptLineNumber
        message = Redact-Diagnostic $failure.Exception.Message
    }
    # Do not put request headers, response bodies, runtime data or keys in logs.
    Write-Warning ('Windows resident acceptance failed at stage: ' + $script:stage)
    Write-Warning ($evidence.failure | ConvertTo-Json -Compress)
    throw ('Windows resident acceptance failed at stage: ' + $script:stage)
} finally {
    try {
        if (Test-Path -LiteralPath (Join-Path $residentHome 'owner.json')) { $null = Run-Launcher 'uninstall' }
    } catch { Write-Warning 'CI-owned resident cleanup requires runner disposal.' }
    $collision = Get-ScheduledTask -TaskName $collisionTaskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($collision -and $collision.Description -eq ('BLACKHOLE resident-v2 ' + $testId)) {
        Unregister-ScheduledTask -TaskName $collisionTaskName -TaskPath '\' -Confirm:$false
    }
    $parent = Split-Path -Parent $EvidencePath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    # Test data is deliberately not uploaded. The ephemeral runner removes it.
    $secureToken.Dispose()
    $token = $null
}
