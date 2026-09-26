[CmdletBinding()]
param([string]$HomeDir = (Join-Path $env:LOCALAPPDATA 'BLACKHOLE\resident-v2'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$utf8 = New-Object Text.UTF8Encoding($false)
$window = New-Object Windows.Forms.Form
$window.Text = 'BLACKHOLE - 휴대폰 연결'
$window.ClientSize = New-Object Drawing.Size(410, 685)
$window.StartPosition = 'CenterScreen'
$window.FormBorderStyle = 'FixedDialog'
$window.MaximizeBox = $false
$label = New-Object Windows.Forms.Label
$label.SetBounds(20, 15, 370, 75)
$label.Text = '같은 사설망의 Android BLACKHOLE 앱에서 QR을 스캔하세요. 초대는 5분 동안 기기 한 대 등록에만 사용할 수 있습니다.'
$picture = New-Object Windows.Forms.PictureBox
$picture.SetBounds(25, 90, 360, 360)
$button = New-Object Windows.Forms.Button
$button.SetBounds(20, 470, 370, 45)
$button.Text = '휴대폰 등록 QR 만들기'
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
$window.Controls.AddRange(@($label,$picture,$button,$modelLabel,$models,$loadModels,$saveModel))
$script:invitation = $null
$script:bridge = $null
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
try {
    $owner = [IO.File]::ReadAllText((Join-Path $HomeDir 'owner.json')) | ConvertFrom-Json
    if ($owner.ownerSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Owner mismatch' }
    $entry = Join-Path $owner.root 'runtime\owner-pairing.mjs'
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
            $button.Text = '이 초대 취소 후 새 QR 만들기'
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
            $null = & (Join-Path $owner.root 'scripts\blackhole-resident.ps1') -Action restart -Root $owner.root -HomeDir $HomeDir -TaskName $owner.taskName
            $modelLabel.Text = '저장·재시작 완료. 자동 실행은 켜지지 않습니다.'
        } catch { $modelLabel.Text = '진행 중인 작업·Ollama·본체 상태를 확인하세요.' }
        finally { $saveModel.Enabled = $true }
    })
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 1000
    $timer.Add_Tick({ if ($script:invitation -and [DateTimeOffset]::UtcNow -ge [DateTimeOffset]::Parse($script:invitation.expiresAt)) { Clear-Invitation; $label.Text = '초대가 만료되었습니다. 새 QR을 만들어 주세요.' } })
    $timer.Start()
    $window.Add_FormClosing({ Clear-Invitation })
    $null = $window.ShowDialog()
    $timer.Stop(); $timer.Dispose()
} catch {
    $null = [Windows.Forms.MessageBox]::Show('이 사용자 계정에 BLACKHOLE resident를 설치하고 실행한 뒤 다시 열어 주세요.', 'BLACKHOLE')
} finally {
    if ($script:bridge) { $script:bridge.StandardInput.Close(); $script:bridge.WaitForExit(7000) | Out-Null; $script:bridge.Dispose() }
    $window.Dispose()
}
