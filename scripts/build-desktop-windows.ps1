[CmdletBinding()]
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$SourceSha = $env:GITHUB_SHA
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = [IO.Path]::GetFullPath($Root)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if ($SourceSha -notmatch '^[a-f0-9]{40}$') { throw 'A pinned source SHA is required.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Build output must be a new directory.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$package = Join-Path $OutputDirectory 'BLACKHOLE'
New-Item -ItemType Directory -Path $package | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)

# Only tracked application files enter the package. Never copy a working-tree data
# directory, secrets, test output, .env files, Git metadata, or developer credentials.
$tracked = @(& git -c core.quotepath=false -C $Root ls-files -- runtime docs identity README.md LICENSE LICENSE.md NOTICE scripts/android-release.mjs)
if ($LASTEXITCODE -ne 0) { throw 'Cannot obtain the tracked distribution manifest.' }
$copied = 0
foreach ($relative in $tracked) {
  if ($relative -match '(^|/)(test|tests|data|node_modules|\.git|secrets)(/|$)' -or
      $relative -match '(^|/)\.env($|\.)' -or $relative -match '\.(key|pfx|pem|p12|token)$') { continue }
  if ($relative -notmatch '^(runtime/|docs/|identity/|README\.md$|LICENSE(?:\.md)?$|NOTICE$|scripts/android-release\.mjs$)') { continue }
  $source = Join-Path $Root $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Tracked distribution file missing.' }
  if (((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Distribution reparse points are forbidden.' }
  $destination = Join-Path $package $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
  $copied++
}
if (-not (Test-Path -LiteralPath (Join-Path $package 'runtime/desktop.mjs'))) { throw 'Desktop entry was not included.' }

$dependencyRoot = Join-Path $Root 'runtime/node_modules'
if (-not (Test-Path -LiteralPath $dependencyRoot -PathType Container)) { throw 'Run the locked npm ci first.' }
foreach ($item in Get-ChildItem -LiteralPath $dependencyRoot -Recurse -Force) {
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Dependency reparse points are forbidden.' }
}
Copy-Item -LiteralPath $dependencyRoot -Destination (Join-Path $package 'runtime/node_modules') -Recurse

$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = (& $node --version).Trim()
if ($nodeVersion -notmatch '^v24\.\d+\.\d+$') { throw 'The distribution requires Node 24.' }
$nodeSignature = Get-AuthenticodeSignature -FilePath $node
if ($nodeSignature.Status -ne 'Valid') { throw 'Bundled Node must retain a valid publisher signature.' }
Copy-Item -LiteralPath $node -Destination (Join-Path $package 'node.exe')
$license = Join-Path (Split-Path -Parent $node) 'LICENSE'
if (-not (Test-Path -LiteralPath $license -PathType Leaf)) { throw 'Node LICENSE must be present in setup-node distribution.' }
Copy-Item -LiteralPath $license -Destination (Join-Path $package 'NODE_LICENSE.txt')

$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw '.NET Framework C# compiler is unavailable.' }
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /utf8output /codepage:65001 "/out:$package/BLACKHOLE.exe" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Security.dll (Join-Path $Root 'scripts/desktop/BlackholeLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native launcher compilation failed.' }

# Resolve the complete runtime import graph from the staged package, not the
# source checkout. This catches an omitted transitive file before shipping.
Push-Location $package
try {
  $importCheck = & (Join-Path $package 'node.exe') --input-type=module -e "await import('./runtime/desktop.mjs'); console.log('BLACKHOLE_PACKAGED_IMPORT_OK')"
  if ($LASTEXITCODE -ne 0 -or $importCheck -ne 'BLACKHOLE_PACKAGED_IMPORT_OK') { throw 'Packaged desktop imports are incomplete.' }
} finally { Pop-Location }

$manifest = [ordered]@{
  formatVersion = 1; product = 'BLACKHOLE'; sourceSha = $SourceSha
  builtAt = [DateTime]::UtcNow.ToString('o'); nodeVersion = $nodeVersion
  platform = 'windows-x64'; minimumOS = 'Windows 10 with .NET Framework 4.x'
  launcherSigned = $false; nodeSignature = $nodeSignature.Status.ToString()
  copiedTrackedFiles = $copied; userDataIncluded = $false; providerCredentialsIncluded = $false
}
[IO.File]::WriteAllText((Join-Path $package 'BUILD.json'), ($manifest | ConvertTo-Json -Depth 5), $utf8)
[IO.File]::WriteAllText((Join-Path $package 'SOURCE_COMMIT.txt'), ($SourceSha+"`n"), $utf8)
[IO.File]::WriteAllText((Join-Path $package 'START_HERE.txt'), @'
BLACKHOLE - 개인용 Windows 실행판

1. ZIP을 새 폴더에 모두 풀고 BLACKHOLE.exe를 실행하세요.
2. 열린 시작 화면에서 새 개인 저장소 생성을 확인하고 연결 키를 지정하세요.
3. 모델 API 키는 선택 사항입니다. 키 없이도 기억·문서·작업·결과 보존을 씁니다.
4. 트레이 아이콘의 BLACKHOLE 열기 / 종료로 제어합니다.

기존 클라우드·노트북 설치·폰 연결·Obsidian 데이터는 자동 이전하지 않습니다.
개인 데이터는 Windows 사용자 전용 LOCALAPPDATA/BLACKHOLE/desktop-v1에 저장됩니다.
API 키와 연결 키는 Windows DPAPI CurrentUser로 암호화됩니다.
이 실행 파일은 아직 코드 서명되지 않았으므로 Windows가 경고할 수 있습니다.
조직의 보안 정책이 막으면 정책을 우회하지 말고 설치를 중단하세요.
실제 폰/Tailscale 연결 및 외부 모델 비용·권한은 별도 확인이 필요합니다.
이 프로그램은 세계 1위·모든 프로젝트 완성·자동 수익을 주장하지 않습니다.

NODE_LICENSE.txt와 runtime/node_modules 안의 LICENSE/NOTICE를 보존하세요.
BUILD.json은 정확한 소스 버전, SHA256SUMS.txt는 내부 파일 해시를 제공합니다.
'@, $utf8)

$lines = @()
foreach ($file in Get-ChildItem -LiteralPath $package -Recurse -File | Sort-Object FullName) {
  $relative = $file.FullName.Substring($package.Length + 1).Replace('\','/')
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $lines += "$hash  $relative"
}
[IO.File]::WriteAllLines((Join-Path $package 'SHA256SUMS.txt'), $lines, $utf8)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $OutputDirectory ("BLACKHOLE-Windows-x64-" + $SourceSha.Substring(0,12) + '.zip')
[IO.Compression.ZipFile]::CreateFromDirectory($package, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($zip + '.sha256'), "$zipHash  $([IO.Path]::GetFileName($zip))`n", $utf8)
Write-Output ([ordered]@{ sourceSha=$SourceSha; archive=$zip; sha256=$zipHash; launcherSigned=$false } | ConvertTo-Json -Compress)
