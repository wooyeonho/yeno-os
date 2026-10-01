[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Protect','Unprotect')][string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBytes = $null
$outputBytes = $null
try {
  $encoded = [Console]::In.ReadLine()
  if (-not $encoded -or $encoded.Length -gt 32768 -or $encoded -notmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'Invalid input' }
  $inputBytes = [Convert]::FromBase64String($encoded)
  $entropy = [Text.Encoding]::UTF8.GetBytes('BLACKHOLE-RESIDENT-v2')
  if ($Action -eq 'Protect') {
    $outputBytes = [Security.Cryptography.ProtectedData]::Protect($inputBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else {
    $outputBytes = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  }
  [Console]::Out.WriteLine([Convert]::ToBase64String($outputBytes))
} catch {
  [Console]::Error.WriteLine('RESIDENT_PROVIDER_CRYPTO_FAILED')
  exit 1
} finally {
  if ($inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
  if ($outputBytes) { [Array]::Clear($outputBytes, 0, $outputBytes.Length) }
}
