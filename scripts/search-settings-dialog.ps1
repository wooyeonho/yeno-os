function New-SearchSettingsDialog {
    param([scriptblock]$SendRequest)
    $dialog = New-Object Windows.Forms.Form
    $dialog.Text = 'BLACKHOLE - 검색 키 보관'
    $dialog.ClientSize = New-Object Drawing.Size(410, 390)
    $dialog.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Font
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.StartPosition = 'CenterParent'
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $hint = New-Object Windows.Forms.Label
    $hint.SetBounds(20, 15, 370, 55)
    $hint.Text = "모델 키와 별도로 이 Windows 사용자에게 암호화합니다.`r`n공급자 어댑터 미연결 · 실검색 미검증"
    $provider = New-Object Windows.Forms.ComboBox
    $provider.Name = 'SearchProvider'
    $provider.SetBounds(20, 80, 370, 30)
    $provider.DropDownStyle = 'DropDownList'
    $provider.AccessibleName = '검색 공급자 선택'
    $provider.Items.AddRange(@('brave', 'tavily'))
    $keyLabel = New-Object Windows.Forms.Label
    $keyLabel.SetBounds(20, 120, 370, 25)
    $keyLabel.Text = '검색 API 키 (소유자만 입력)'
    $key = New-Object Windows.Forms.TextBox
    $key.Name = 'SearchKey'
    $key.SetBounds(20, 150, 370, 30)
    $key.UseSystemPasswordChar = $true
    $key.MaxLength = 4096
    $key.AccessibleName = '검색 API 키'
    $save = New-Object Windows.Forms.Button
    $save.Name = 'SaveSearchKey'
    $save.SetBounds(20, 195, 180, 42)
    $save.Text = '암호화 저장'
    $save.Enabled = $false
    $statusButton = New-Object Windows.Forms.Button
    $statusButton.Name = 'ReadSearchStatus'
    $statusButton.SetBounds(210, 195, 180, 42)
    $statusButton.Text = '저장 상태 확인'
    $status = New-Object Windows.Forms.Label
    $status.Name = 'SearchCredentialStatus'
    $status.SetBounds(20, 252, 370, 25)
    $status.Text = ''
    $message = New-Object Windows.Forms.Label
    $message.Name = 'SearchSettingsMessage'
    $message.SetBounds(20, 290, 370, 75)
    $message.Text = '저장은 검색·재시작·자동 실행을 하지 않습니다. 공급자 변경 시 새 키를 입력하세요.'
    $dialog.Controls.AddRange(@($hint,$provider,$keyLabel,$key,$save,$statusButton,$status,$message))
    $toggle = { $save.Enabled = $null -ne $provider.SelectedItem -and $key.Text.Length -ge 8 }.GetNewClosure()
    $provider.Add_SelectedIndexChanged($toggle)
    $key.Add_TextChanged($toggle)
    $save.Add_Click({
        $save.Enabled = $false
        $status.Text = ''
        try {
            $reply = & $SendRequest @{action='save-search-settings';provider=[string]$provider.SelectedItem;apiKey=$key.Text}
            if (-not $reply.ok -or $reply.credentialStatus -ne 'saved') { throw 'Save failed' }
            $status.Text = '저장됨'
            $message.Text = '공급자 어댑터 미연결 · 실검색 미검증. 저장한 키는 아직 검색에 사용되지 않습니다.'
        } catch { $message.Text = '저장 확인에 실패했습니다. 상태를 다시 확인하세요.' }
        finally { $key.Clear(); $save.Enabled = $false }
    }.GetNewClosure())
    $statusButton.Add_Click({
        $status.Text = ''
        try {
            $reply = & $SendRequest @{action='search-settings-status'}
            if (-not $reply.ok -or $reply.credentialStatus -notin @('saved','unset')) { throw 'Status failed' }
            $status.Text = if ($reply.credentialStatus -eq 'saved') { '저장됨' } else { '미설정' }
        } catch { $message.Text = '저장 상태를 확인하지 못했습니다.' }
    }.GetNewClosure())
    $dialog.Add_FormClosing({ $key.Clear() }.GetNewClosure())
    return ,$dialog
}
