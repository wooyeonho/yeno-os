[CmdletBinding()]
param([string]$HomeDir = (Join-Path $env:LOCALAPPDATA 'BLACKHOLE\resident-v2'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$utf8 = New-Object Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'search-settings-dialog.ps1')
. (Join-Path $PSScriptRoot 'signing-trust-dialog.ps1')
$window = New-Object Windows.Forms.Form
$window.Text = 'BLACKHOLE - 소유자 연결 설정'
$window.ClientSize = New-Object Drawing.Size(450, 735)
$window.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Font
$window.StartPosition = 'CenterScreen'
$window.FormBorderStyle = 'FixedDialog'
$window.MaximizeBox = $false
$tabs = New-Object Windows.Forms.TabControl
$tabs.Dock = 'Fill'
$setupPage = New-Object Windows.Forms.TabPage
$setupPage.Text = '기기 · 모델 설정'
$setupPage.AutoScroll = $true
$connectorPage = New-Object Windows.Forms.TabPage
$connectorPage.Text = '커넥터 목록'
$connectorPage.AutoScroll = $true
$tabs.TabPages.AddRange(@($setupPage, $connectorPage))
$window.Controls.Add($tabs)
$label = New-Object Windows.Forms.Label
$label.SetBounds(20, 15, 370, 75)
$label.Text = '같은 사설망의 Android BLACKHOLE 앱에서 QR을 스캔하세요. 초대는 5분 동안 기기 한 대 등록에만 사용할 수 있습니다.'
$picture = New-Object Windows.Forms.PictureBox
$picture.SetBounds(25, 90, 360, 360)
$button = New-Object Windows.Forms.Button
$button.SetBounds(20, 470, 180, 45)
$button.Text = '휴대폰 QR 만들기'
$browserButton = New-Object Windows.Forms.Button
$browserButton.SetBounds(210, 470, 180, 45)
$browserButton.Text = '브라우저 연결 승인'
$modelLabel = New-Object Windows.Forms.Label
$modelLabel.SetBounds(20, 525, 370, 25)
$modelLabel.Text = '이 PC의 로컬 모델 (Ollama)'
$models = New-Object Windows.Forms.ComboBox
$models.SetBounds(20, 555, 250, 30)
$models.DropDownStyle = 'DropDownList'
$loadModels = New-Object Windows.Forms.Button
$loadModels.SetBounds(280, 555, 110, 30)
$loadModels.Text = '모델 조회'
$saveModel = New-Object Windows.Forms.Button
$saveModel.SetBounds(20, 600, 370, 40)
$saveModel.Text = '선택 모델 저장 후 본체 재시작'
$saveModel.Enabled = $false
$providerLabel = New-Object Windows.Forms.Label
$providerLabel.SetBounds(20, 650, 370, 45)
$providerLabel.Text = '원격 모델 설정 (사용자 전용 암호화 저장, 하루 최대 2회 · 비용이 들 수 있음)'
$provider = New-Object Windows.Forms.ComboBox
$provider.SetBounds(20, 705, 370, 30)
$provider.DropDownStyle = 'DropDownList'
$null = $provider.Items.Add('nvidia')
$null = $provider.Items.Add('gemini')
$null = $provider.Items.Add('openai')
$provider.SelectedIndex = 0
$remoteModelLabel = New-Object Windows.Forms.Label
$remoteModelLabel.SetBounds(20, 740, 370, 20)
$remoteModelLabel.Text = '모델 ID'
$remoteModel = New-Object Windows.Forms.TextBox
$remoteModel.SetBounds(20, 762, 370, 30)
$remoteModel.Text = ''
$remoteKeyLabel = New-Object Windows.Forms.Label
$remoteKeyLabel.SetBounds(20, 800, 370, 20)
$remoteKeyLabel.Text = 'API 키 (이 PC에서만 입력)'
$remoteKey = New-Object Windows.Forms.TextBox
$remoteKey.SetBounds(20, 822, 370, 30)
$remoteKey.UseSystemPasswordChar = $true
$saveProvider = New-Object Windows.Forms.Button
$saveProvider.SetBounds(20, 865, 370, 40)
$saveProvider.Text = '원격 모델 암호화 저장 후 본체 재시작'
$testProvider = New-Object Windows.Forms.Button
$testProvider.SetBounds(20, 915, 370, 40)
$testProvider.Text = '실제 모델 1회 연결 시험 (비용 발생 가능)'
$providerTestStatus = New-Object Windows.Forms.Label
$providerTestStatus.SetBounds(20, 965, 370, 45)
$providerTestStatus.Text = '시험은 AI·자동 실행을 켜지 않습니다.'
$setupPage.Controls.AddRange(@($label,$picture,$button,$browserButton,$modelLabel,$models,$loadModels,$saveModel,$providerLabel,$provider,$remoteModelLabel,$remoteModel,$remoteKeyLabel,$remoteKey,$saveProvider,$testProvider,$providerTestStatus))
$searchSettings = New-Object Windows.Forms.Button
$searchSettings.SetBounds(20, 1030, 370, 42)
$searchSettings.Text = '검색 키 보관 (별도 암호화)'
$setupPage.Controls.Add($searchSettings)
$signingTrust = New-Object Windows.Forms.Button
$signingTrust.SetBounds(20, 1085, 370, 42)
$signingTrust.Text = '서명 키 · 신뢰 목록 (소유자 전용)'
$setupPage.Controls.Add($signingTrust)
$connectorHint = New-Object Windows.Forms.Label
$connectorHint.SetBounds(20, 15, 400, 45)
$connectorHint.Text = "이 PC 본체의 연결 상태를 확인합니다.`r`n목록 조회는 기능 검사를 실행하지 않습니다."
$refreshConnectors = New-Object Windows.Forms.Button
$refreshConnectors.SetBounds(20, 72, 180, 42)
$refreshConnectors.Text = '목록 새로고침'
$checkConnector = New-Object Windows.Forms.Button
$checkConnector.SetBounds(210, 72, 210, 42)
$checkConnector.Text = '1회 시험 연결'
$checkConnector.Enabled = $false
$connectorList = New-Object Windows.Forms.ListView
$connectorList.SetBounds(20, 128, 400, 288)
$connectorList.View = 'Details'
$connectorList.FullRowSelect = $true
$connectorList.MultiSelect = $false
$connectorList.HideSelection = $false
$connectorList.AccessibleName = '커넥터 이름과 연결 상태'
$null = $connectorList.Columns.Add('커넥터', 238)
$null = $connectorList.Columns.Add('상태', 138)
$connectorDetails = New-Object Windows.Forms.Label
$connectorDetails.SetBounds(20, 432, 400, 200)
$connectorDetails.UseMnemonic = $false
$connectorDetails.Text = '목록 새로고침을 누른 뒤 커넥터를 선택하세요.'
$connectorStatus = New-Object Windows.Forms.Label
$connectorStatus.SetBounds(20, 645, 400, 48)
$connectorStatus.Text = '시험 연결은 AI와 자동 실행을 켜지 않습니다.'
$connectorPage.Controls.AddRange(@($connectorHint,$refreshConnectors,$checkConnector,$connectorList,$connectorDetails,$connectorStatus))
$script:invitation = $null
$script:bridge = $null
$script:connectorRead = $null
$script:connectorAction = $null
function Send-Bridge([hashtable]$Payload) {
    $json = $Payload | ConvertTo-Json -Compress
    # .NET Framework stdin uses a console code page; escape Unicode paths so
    # the private JSON pipe is identical on Korean and English Windows.
    $ascii = [regex]::Replace($json, '[^\x00-\x7F]', { param($match) '\u' + ([int][char]$match.Value).ToString('x4') })
    $script:bridge.StandardInput.WriteLine($ascii)
}
function Clear-Invitation {
    if ($picture.Image) { $picture.Image.Dispose(); $picture.Image = $null }
    if ($script:invitation -and $script:bridge -and -not $script:bridge.HasExited) {
        Send-Bridge @{home=$HomeDir;action='cancel';id=$script:invitation.id}
        $null = $script:bridge.StandardOutput.ReadLine()
    }
    $script:invitation = $null
}
function Get-ConnectorStatus($Row) {
    if ($Row.status -eq 'connected') {
        if ($null -eq $Row.lastCheck -or -not $Row.lastCheck.ok) { return '확인 필요' }
        if ([DateTimeOffset]::UtcNow -ge [DateTimeOffset]::Parse($Row.lastCheck.expiresAt)) { return '검사 만료' }
        if ($Row.lastCheck.evidenceClass -eq 'synthetic') { return '합성 검사 통과' }
        if ($Row.lastCheck.evidenceClass -ne 'live') { return '확인 필요' }
    }
    switch ($Row.status) {
        'not_installed' { return '설치 안 됨' }
        'installed' { return '설치됨' }
        'needs_owner' { return '내 입력 필요' }
        'connected' { return '연결됨' }
        'blocked' { return '막힘' }
        'not_implemented' { return '어댑터 미구현' }
        default { return '확인 필요' }
    }
}
function Show-ConnectorDetails {
    $checkConnector.Enabled = $false
    if ($connectorList.SelectedItems.Count -eq 0) { return }
    $row = $connectorList.SelectedItems[0].Tag
    $license = if ($row.upstream.license) { [string]$row.upstream.license } else { '미확인' }
    $version = if ($row.upstream.pinnedVersion) { [string]$row.upstream.pinnedVersion } else { '미확인' }
    $reasons = @{ connector_probe_not_implemented='어댑터 기능 검사 구현이 필요합니다.'; ready_for_check='소유자 시험 연결 대기'; configuration_required='기존 설정에서 연결 정보를 확인하세요.'; disabled='사용이 꺼져 있습니다.'; invalid_configuration='연결 설정을 확인하세요.'; trusted_ca_required='신뢰할 인증서 설정이 필요합니다.'; check_expired='검사 결과가 만료됐습니다.'; config_changed='설정이 바뀌어 다시 확인해야 합니다.'; check_failed='기능 검사를 통과하지 못했습니다.'; check_timeout='검사 제한 시간을 넘겼습니다.'; check_passed='기능 검사를 통과했습니다.' }
    $reason = if ($reasons.ContainsKey([string]$row.reason)) { $reasons[[string]$row.reason] } else { [string]$row.reason }
    $lines = @([string]$row.title, ('업스트림: ' + [string]$row.upstream.name), ('라이선스: ' + $license + ' · 버전: ' + $version), ('상태: ' + (Get-ConnectorStatus $row)), $reason)
    if ($row.lastCheck) {
        $evidence = switch ($row.lastCheck.evidenceClass) { 'synthetic' { '합성 시험' }; 'live' { '실제 기능 검사' }; default { '출처 미확인 검사' } }
        $outcome = if ($row.lastCheck.ok) { '통과' } else { '실패' }
        $lines += $evidence + ' ' + $outcome + ' · ' + [string]$row.lastCheck.roundTripMs + ' ms'
        $lines += '검사 시각: ' + ([DateTimeOffset]::Parse($row.lastCheck.checkedAt).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss'))
        $lines += '유효 시각: ' + ([DateTimeOffset]::Parse($row.lastCheck.expiresAt).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss'))
        if ($row.lastCheck.evidence.backend) { $lines += '백엔드: ' + [string]$row.lastCheck.evidence.backend }
    } else { $lines += '아직 기능 검사 증거가 없습니다.' }
    $connectorDetails.Text = $lines -join "`r`n"
    $checkConnector.Enabled = [bool]$row.canCheck -and $null -eq $script:connectorRead
}
function Set-ConnectorRows($Rows) {
    $selected = if ($connectorList.SelectedItems.Count) { $connectorList.SelectedItems[0].Name } else { $null }
    $connectorList.BeginUpdate()
    try {
        $connectorList.Items.Clear()
        foreach ($row in $Rows) {
            $item = New-Object Windows.Forms.ListViewItem([string]$row.title)
            $item.Name = [string]$row.id
            $item.Tag = $row
            $null = $item.SubItems.Add((Get-ConnectorStatus $row))
            $null = $connectorList.Items.Add($item)
            if ($row.id -eq $selected) { $item.Selected = $true }
        }
    } finally { $connectorList.EndUpdate() }
    if ($connectorList.Items.Count) {
        $rowBounds = $connectorList.GetItemRect(0)
        $frameHeight = $connectorList.Height - $connectorList.ClientSize.Height
        $wholeRows = [Math]::Max(1, [Math]::Floor(($connectorList.ClientSize.Height - $rowBounds.Top) / $rowBounds.Height))
        $connectorList.Height = $frameHeight + $rowBounds.Top + $wholeRows * $rowBounds.Height
    }
    $connectorDetails.Text = if ($connectorList.Items.Count) { '커넥터를 선택하면 기능 검사 근거를 볼 수 있습니다.' } else { '본체가 반환한 커넥터가 없습니다.' }
    Show-ConnectorDetails
}
function Start-ConnectorRequest([string]$Action) {
    if ($null -ne $script:connectorRead) { return }
    $payload = @{home=$HomeDir;action=$Action}
    if ($Action -eq 'check-connector') {
        if ($connectorList.SelectedItems.Count -eq 0 -or -not $connectorList.SelectedItems[0].Tag.canCheck) { return }
        $payload.id = $connectorList.SelectedItems[0].Name
    }
    $refreshConnectors.Enabled = $false; $checkConnector.Enabled = $false; $setupPage.Enabled = $false; $connectorList.Enabled = $false
    $connectorStatus.Text = if ($Action -eq 'connectors') { '본체에서 상태를 읽는 중입니다.' } else { "선택한 기능을 1회 검사 중입니다.`r`n완료될 때까지 기다려 주세요." }
    try {
        Send-Bridge $payload
        $script:connectorAction = $Action
        $script:connectorRead = $script:bridge.StandardOutput.ReadLineAsync()
    } catch {
        $connectorStatus.Text = "본체에 요청을 전달하지 못했습니다.`r`n이전 목록이 남아 있습니다. 새로고침하세요."
        $refreshConnectors.Enabled = $true; $setupPage.Enabled = $true; $connectorList.Enabled = $true
        Show-ConnectorDetails
    }
}
try {
    $owner = [IO.File]::ReadAllText((Join-Path $HomeDir 'owner.json')) | ConvertFrom-Json
    if ($owner.ownerSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Owner mismatch' }
    $entry = Join-Path $owner.root 'runtime\owner-pairing.mjs'
    $restartScript = Join-Path $owner.root 'scripts\blackhole-resident.ps1'
    if (-not (Test-Path -LiteralPath $entry)) { throw 'Pairing component missing' }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $owner.nodeExecutable
    $info.Arguments = '"' + $entry + '" --gui-pipe'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $utf8
    $script:bridge = [Diagnostics.Process]::Start($info)
    $browserButton.Add_Click({
        $browserButton.Enabled = $false
        $dialog = New-Object Windows.Forms.Form
        $dialog.Text = 'BLACKHOLE - 브라우저 연결 승인'
        $dialog.ClientSize = New-Object Drawing.Size(410, 220)
        $dialog.StartPosition = 'CenterParent'
        $dialog.FormBorderStyle = 'FixedDialog'
        $dialog.MaximizeBox = $false
        $dialog.MinimizeBox = $false
        $dialog.ShowInTaskbar = $false
        $hint = New-Object Windows.Forms.Label
        $hint.SetBounds(20, 15, 370, 50)
        $hint.Text = '브라우저에 표시된 요청 번호와 일치하는지 확인하세요. 번호는 비밀키가 아닙니다. 요청은 10분 후 만료됩니다.'
        $reference = New-Object Windows.Forms.TextBox
        $reference.SetBounds(20, 75, 370, 32)
        $reference.MaxLength = 36
        $reference.CharacterCasing = 'Lower'
        $approve = New-Object Windows.Forms.Button
        $approve.SetBounds(20, 120, 270, 42)
        $approve.Text = '이 브라우저 연결 승인'
        $cancel = New-Object Windows.Forms.Button
        $cancel.SetBounds(305, 120, 85, 42)
        $cancel.Text = '닫기'
        $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
        $status = New-Object Windows.Forms.Label
        $status.SetBounds(20, 175, 370, 35)
        $dialog.Controls.AddRange(@($hint,$reference,$approve,$cancel,$status))
        $dialog.AcceptButton = $approve
        $dialog.CancelButton = $cancel
        $dialog.ActiveControl = $reference
        $approvalBridge = $script:bridge
        $approve.Add_Click({
            $id = $reference.Text.Trim()
            if ($id -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') {
                $status.Text = '브라우저 화면의 요청 번호 36자를 확인해 주세요.'
                return
            }
            $approve.Enabled = $false
            try {
                Send-Bridge @{home=$HomeDir;action='approve-browser';id=$id}
                $reply = $approvalBridge.StandardOutput.ReadLine() | ConvertFrom-Json
                if (-not $reply.ok) {
                    if ($reply.code -eq 'BROWSER_REFERENCE_EXPIRED') { $status.Text = '요청이 만료됐습니다. 브라우저에서 새 연결 요청을 시작하세요.'; $approve.Enabled = $true; return }
                    throw 'Browser approval failed'
                }
                if ($reply.id -ne $id -or $reply.status -ne 'approved') { throw 'Browser approval failed' }
                $status.Text = '승인 완료. 브라우저가 자동으로 연결됩니다.'
            } catch {
                $status.Text = '요청 번호·만료·본체 상태를 확인해 주세요.'
                $approve.Enabled = $true
            }
        }.GetNewClosure())
        try { $null = $dialog.ShowDialog($window) }
        finally { $dialog.Dispose(); $browserButton.Enabled = $true }
    })
    $button.Add_Click({
        $button.Enabled = $false
        try {
            Clear-Invitation
            Send-Bridge @{home=$HomeDir;action='issue'}
            $reply = $script:bridge.StandardOutput.ReadLine() | ConvertFrom-Json
            if (-not $reply.ok) { throw 'Pairing unavailable' }
            $script:invitation = $reply
            $bytes = [Convert]::FromBase64String(($reply.image -split ',',2)[1])
            $stream = New-Object IO.MemoryStream(,$bytes)
            try { $sourceImage = [Drawing.Image]::FromStream($stream); $picture.Image = New-Object Drawing.Bitmap($sourceImage); $sourceImage.Dispose() } finally { $stream.Dispose() }
            $label.Text = $reply.origin + "`r`n초대 만료: " + ([DateTimeOffset]::Parse($reply.expiresAt).ToLocalTime().ToString('HH:mm:ss'))
            $button.Text = '초대 취소·새 QR'
        } catch { $label.Text = '본체 실행과 Tailscale 사설 HTTPS 설정을 확인한 뒤 다시 시도하세요.' }
        finally { $button.Enabled = $true }
    })
    $loadModels.Add_Click({
        try {
            Send-Bridge @{home=$HomeDir;action='models'}
            $reply = $script:bridge.StandardOutput.ReadLine() | ConvertFrom-Json
            if (-not $reply.ok) { throw 'Models unavailable' }
            $models.Items.Clear()
            foreach ($name in $reply.models) { $null = $models.Items.Add($name) }
            if ($reply.selected) { $models.SelectedItem = $reply.selected }
            $saveModel.Enabled = $models.Items.Count -gt 0
        } catch { $modelLabel.Text = 'Ollama 실행과 설치된 모델을 확인하세요.' }
    })
    $saveModel.Add_Click({
        if (-not $models.SelectedItem) { return }
        $saveModel.Enabled = $false
        try {
            Send-Bridge @{home=$HomeDir;action='save-model';model=[string]$models.SelectedItem}
            $reply = $script:bridge.StandardOutput.ReadLine() | ConvertFrom-Json
            if (-not $reply.ok) { throw 'Model save failed' }
            Clear-Invitation
            $null = & $restartScript -Action restart -Root $owner.root -HomeDir $HomeDir -TaskName $owner.taskName
            Set-ConnectorRows @()
            $connectorStatus.Text = '본체 설정이 바뀌었습니다. 커넥터 목록을 새로고침하세요.'
            $modelLabel.Text = '저장·재시작 완료. 자동 실행은 켜지지 않습니다.'
        } catch { $modelLabel.Text = '진행 중인 작업·Ollama·본체 상태를 확인하세요.' }
        finally { $saveModel.Enabled = $true }
    })
    $saveProvider.Add_Click({
        $saveProvider.Enabled = $false
        try {
            Send-Bridge @{home=$HomeDir;action='save-provider';provider=[string]$provider.SelectedItem;model=$remoteModel.Text;apiKey=$remoteKey.Text}
            $reply = $script:bridge.StandardOutput.ReadLine() | ConvertFrom-Json
            if (-not $reply.ok) { throw 'Provider save failed' }
            Clear-Invitation
            $null = & $restartScript -Action restart -Root $owner.root -HomeDir $HomeDir -TaskName $owner.taskName
            Set-ConnectorRows @()
            $connectorStatus.Text = '본체 설정이 바뀌었습니다. 커넥터 목록을 새로고침하세요.'
            $providerLabel.Text = '원격 설정 저장·재시작 완료. AI와 자동 실행은 꺼져 있습니다.'
        } catch { $providerLabel.Text = '본체 상태·모델 ID·키를 확인하세요. 기존 작업은 보존됩니다.' }
        finally { $remoteKey.Clear(); $saveProvider.Enabled = $true }
    })
    $searchSettings.Add_Click({
        $sendSearch = { param($request)
            $request.home = $HomeDir
            Send-Bridge $request
            return ($script:bridge.StandardOutput.ReadLine() | ConvertFrom-Json)
        }
        $searchDialog = New-SearchSettingsDialog -SendRequest $sendSearch
        try { $null = $searchDialog.ShowDialog($window) } finally { $searchDialog.Dispose() }
    })
    $signingTrust.Add_Click({
        $sendSigning = { param($request)
            $request.home = $HomeDir
            Send-Bridge $request
            return ($script:bridge.StandardOutput.ReadLine() | ConvertFrom-Json)
        }
        $signingDialog = New-SigningTrustDialog -SendRequest $sendSigning
        try { $null = $signingDialog.ShowDialog($window) } finally { $signingDialog.Dispose() }
    })
    $testProvider.Add_Click({
        $testProvider.Enabled = $false
        try {
            Send-Bridge @{home=$HomeDir;action='test-provider'}
            $reply = $script:bridge.StandardOutput.ReadLine() | ConvertFrom-Json
            if (-not $reply.ok) { throw 'Provider test failed' }
            if ($reply.status -eq 'LIVE_VERIFIED') { $providerTestStatus.Text = '실제 모델 응답 확인. 작업 화면에서 결과를 확인하세요.' }
            elseif ($reply.status -eq 'OUTCOME_UNKNOWN' -or $reply.status -eq 'REQUESTED') {
                $providerTestStatus.Text = '모델 결과가 불확실합니다. 중복 호출하지 말고 작업 상태를 확인하세요.'
                return
            } else { $providerTestStatus.Text = '연결 시험 미완료: ' + [string]$reply.status }
        } catch { $providerTestStatus.Text = '본체와 저장된 공급자 설정을 확인하세요.' }
        finally { if ($providerTestStatus.Text -notmatch '중복 호출하지 말고') { $testProvider.Enabled = $true } }
    })
    $connectorList.Add_SelectedIndexChanged({ Show-ConnectorDetails })
    $refreshConnectors.Add_Click({ Start-ConnectorRequest 'connectors' })
    $checkConnector.Add_Click({ Start-ConnectorRequest 'check-connector' })
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 250
    $timer.Add_Tick({
        if ($script:connectorRead -and $script:connectorRead.IsCompleted) {
            $pending = $script:connectorRead
            $script:connectorRead = $null
            try {
                $reply = $pending.GetAwaiter().GetResult() | ConvertFrom-Json
                if (-not $reply.ok) { throw 'Connector request failed' }
                if ($script:connectorAction -eq 'connectors') {
                    Set-ConnectorRows $reply.connectors
                    $connectorHint.Text = '목록 조회: ' + ([DateTimeOffset]::Now.ToString('HH:mm:ss')) + '. 새로고침은 기능 검사를 실행하지 않습니다.'
                    $connectorStatus.Text = '상태 조회 완료. 기능 검사는 선택한 버튼에서만 실행됩니다.'
                } else {
                    $items = $connectorList.Items.Find([string]$reply.connector.id, $false)
                    if ($items.Count -ne 1) { throw 'Connector selection changed' }
                    $items[0].Tag = $reply.connector
                    $items[0].SubItems[1].Text = Get-ConnectorStatus $reply.connector
                    $connectorStatus.Text = '시험 완료: ' + (Get-ConnectorStatus $reply.connector) + '. 아래 검사 근거를 확인하세요.'
                }
            } catch { $connectorStatus.Text = "상태를 확인하지 못했습니다.`r`n이전 목록이 남아 있습니다. 새로고침하세요." }
            finally {
                $script:connectorAction = $null
                $refreshConnectors.Enabled = $true; $setupPage.Enabled = $true; $connectorList.Enabled = $true
                Show-ConnectorDetails
            }
        }
        if ($null -eq $script:connectorRead -and $script:invitation -and [DateTimeOffset]::UtcNow -ge [DateTimeOffset]::Parse($script:invitation.expiresAt)) {
            Clear-Invitation; $label.Text = '초대가 만료되었습니다. 새 QR을 만들어 주세요.'
        }
        foreach ($item in $connectorList.Items) {
            if ($item.Tag.status -eq 'connected') {
                $statusText = Get-ConnectorStatus $item.Tag
                if ($item.SubItems[1].Text -ne $statusText) {
                    $item.SubItems[1].Text = $statusText
                    if ($item.Selected) { Show-ConnectorDetails }
                }
            }
        }
    })
    $timer.Start()
    $window.Add_FormClosing({
        param($sender, $eventArgs)
        if ($null -ne $script:connectorRead) { $eventArgs.Cancel = $true; $connectorStatus.Text = '진행 중인 요청이 끝난 뒤 창을 닫을 수 있습니다.'; return }
        Clear-Invitation
    })
    $null = $window.ShowDialog()
    $timer.Stop(); $timer.Dispose()
} catch {
    $null = [Windows.Forms.MessageBox]::Show('이 사용자 계정에 BLACKHOLE resident를 설치하고 실행한 뒤 다시 열어 주세요.', 'BLACKHOLE')
} finally {
    if ($script:bridge) { $script:bridge.StandardInput.Close(); $script:bridge.WaitForExit(7000) | Out-Null; $script:bridge.Dispose() }
    $window.Dispose()
}
