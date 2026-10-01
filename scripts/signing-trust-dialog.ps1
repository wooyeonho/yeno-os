function New-SigningTrustDialog {
    param([scriptblock]$SendRequest)
    $dialog = New-Object Windows.Forms.Form
    $dialog.Text = 'BLACKHOLE - 서명 키 · 신뢰 목록'
    $dialog.ClientSize = New-Object Drawing.Size(430, 525)
    $dialog.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Font
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.StartPosition = 'CenterParent'
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false

    $hint = New-Object Windows.Forms.Label
    $hint.SetBounds(18, 14, 395, 62)
    $hint.Text = "소유자가 눌렀을 때만 서명 키를 생성합니다.`r`n개인 키는 이 Windows 사용자에게 암호화해 저장하며 화면에 표시하지 않습니다."
    $status = New-Object Windows.Forms.Label
    $status.SetBounds(18, 83, 395, 53)
    $status.Text = '저장 상태 확인 전 · 실제 외부 검증 0건'
    $refresh = New-Object Windows.Forms.Button
    $refresh.SetBounds(18, 142, 120, 38)
    $refresh.Text = '상태 새로고침'
    $initialize = New-Object Windows.Forms.Button
    $initialize.SetBounds(148, 142, 264, 38)
    $initialize.Text = '내 서명 키 최초 생성'
    $public = New-Object Windows.Forms.Button
    $public.SetBounds(18, 190, 394, 36)
    $public.Text = '내 공개키만 파일로 저장'
    $trustedLabel = New-Object Windows.Forms.Label
    $trustedLabel.SetBounds(18, 238, 394, 26)
    $trustedLabel.Text = '소유자가 신뢰한 공개키 (실제 외부 검증 횟수가 아님)'
    $trusted = New-Object Windows.Forms.ListView
    $trusted.SetBounds(18, 268, 394, 138)
    $trusted.View = 'Details'
    $trusted.FullRowSelect = $true
    $trusted.MultiSelect = $false
    $trusted.AccessibleName = '신뢰한 공개키 이름과 지문'
    $null = $trusted.Columns.Add('이름', 160)
    $null = $trusted.Columns.Add('지문 SHA-256', 208)
    $add = New-Object Windows.Forms.Button
    $add.SetBounds(18, 415, 192, 40)
    $add.Text = '공개키 파일 추가'
    $remove = New-Object Windows.Forms.Button
    $remove.SetBounds(220, 415, 192, 40)
    $remove.Text = '선택한 공개키 철회'
    $message = New-Object Windows.Forms.Label
    $message.SetBounds(18, 467, 394, 48)
    $message.Text = '이 화면은 능력 활성화·외부 검증 판정을 실행하지 않습니다.'
    $dialog.Controls.AddRange(@($hint,$status,$refresh,$initialize,$public,$trustedLabel,$trusted,$add,$remove,$message))

    $load = {
        try {
            $result = & $SendRequest @{action='signing-status'}
            if (-not $result.ok -or $result.identityStatus -notin @('saved','unset')) { throw 'Status failed' }
            $trusted.Items.Clear()
            foreach ($entry in $result.trusted) {
                if ($entry.signerId -notmatch '^[a-f0-9]{64}$') { throw 'Invalid fingerprint' }
                $row = New-Object Windows.Forms.ListViewItem([string]$entry.label)
                $null = $row.SubItems.Add([string]$entry.signerId)
                $row.Tag = [string]$entry.signerId
                $null = $trusted.Items.Add($row)
            }
            $status.Text = if ($result.identityStatus -eq 'saved') { "내 서명 키 저장됨 · 신뢰 목록 $($result.trusted.Count)건`r`n실제 외부 검증 0건" } else { '내 서명 키 미설정 · 실제 외부 검증 0건' }
            $initialize.Enabled = $result.identityStatus -eq 'unset'
            $public.Enabled = $result.identityStatus -eq 'saved'
            $add.Enabled = $result.identityStatus -eq 'saved'
            $remove.Enabled = $result.identityStatus -eq 'saved' -and $trusted.SelectedItems.Count -eq 1
            $message.Text = '신뢰는 이후 가져오기 검증에만 사용합니다. 실행 코드는 활성화하지 않습니다.'
        } catch {
            $status.Text = '저장 상태를 확인하지 못했습니다.'
            $initialize.Enabled = $false; $public.Enabled = $false; $add.Enabled = $false; $remove.Enabled = $false
            $message.Text = '기존 서명 파일을 덮어쓰지 않았습니다.'
        }
    }.GetNewClosure()
    $refresh.Add_Click($load)
    $initialize.Add_Click({
        $initialize.Enabled = $false
        try {
            $result = & $SendRequest @{action='signing-initialize'}
            if (-not $result.ok -or $result.identityStatus -ne 'saved') { throw 'Initialize failed' }
            & $load
        } catch { $message.Text = '생성 확인 실패. 상태를 다시 확인하세요. 기존 키는 덮어쓰지 않습니다.' }
    }.GetNewClosure())
    $public.Add_Click({
        $save = New-Object Windows.Forms.SaveFileDialog
        $save.Filter = 'PEM 공개키 (*.pem)|*.pem'
        $save.FileName = 'blackhole-owner-public.pem'
        try {
            if ($save.ShowDialog($dialog) -ne [Windows.Forms.DialogResult]::OK) { return }
            $result = & $SendRequest @{action='signing-public-key'}
            if (-not $result.ok -or $result.publicKey -notmatch '^-----BEGIN PUBLIC KEY-----') { throw 'Export failed' }
            [IO.File]::WriteAllText($save.FileName, [string]$result.publicKey, (New-Object Text.UTF8Encoding($false)))
            $message.Text = '공개키만 선택한 파일에 저장했습니다. 개인 키는 내보내지 않았습니다.'
        } catch { $message.Text = '공개키 저장에 실패했습니다.' }
        finally { $save.Dispose() }
    }.GetNewClosure())
    $add.Add_Click({
        $open = New-Object Windows.Forms.OpenFileDialog
        $open.Filter = 'PEM 공개키 (*.pem)|*.pem'
        try {
            if ($open.ShowDialog($dialog) -ne [Windows.Forms.DialogResult]::OK) { return }
            $file = Get-Item -LiteralPath $open.FileName
            if ($file.Length -gt 2048) { throw 'Oversize public key' }
            $key = [IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8)
            $name = [IO.Path]::GetFileNameWithoutExtension($file.Name)
            $result = & $SendRequest @{action='signing-trust';label=$name;publicKey=$key}
            if (-not $result.ok) { throw 'Trust failed' }
            & $load
        } catch { $message.Text = '공개키를 신뢰 목록에 추가하지 못했습니다.' }
        finally { $open.Dispose() }
    }.GetNewClosure())
    $trusted.Add_SelectedIndexChanged({ $remove.Enabled = $trusted.SelectedItems.Count -eq 1 }.GetNewClosure())
    $remove.Add_Click({
        if ($trusted.SelectedItems.Count -ne 1) { return }
        try {
            $result = & $SendRequest @{action='signing-untrust';signerId=[string]$trusted.SelectedItems[0].Tag}
            if (-not $result.ok) { throw 'Untrust failed' }
            & $load
        } catch { $message.Text = '신뢰 철회에 실패했습니다. 상태를 다시 확인하세요.' }
    }.GetNewClosure())
    $dialog.Add_Shown($load)
    return ,$dialog
}
