# Mythril installer fixer — run elevated (right-click PowerShell -> Run as administrator).
# Removes stale Mythril product registrations left by the early same-version MSIs,
# then installs the current one.
$ErrorActionPreference = 'Continue'

$guids = @(
  "{08CB7381-44D2-497C-BAD4-0A3FFB2410F6}","{76E5C403-7A2B-478A-8593-9045E05ECD1F}",
  "{7DA23536-02AF-4382-A867-D819FF0DD337}","{8534EA2E-CCCF-4EBC-8A13-745CFDB0FBE6}",
  "{8DC592E1-0ABE-4106-9333-648AD1771FDB}","{99182D90-7F37-445A-B9D9-85CEB073C036}",
  "{9BEF038C-80D9-48B2-BC46-A292FBAB07F8}","{A022B2F7-00FC-4651-97DB-A44C0DF76358}",
  "{AB50F347-BC61-4A32-935F-E2B4A8014F94}"
)

# Uninstall registry entries
foreach ($hive in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
                    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")) {
  foreach ($g in $guids) {
    $p = Join-Path $hive $g
    if (Test-Path $p) { Remove-Item $p -Recurse -Force; Write-Host "removed $p" }
  }
}

# Installer product registrations (packed GUIDs under Products)
foreach ($root in @("HKLM:\SOFTWARE\Classes\Installer\Products", "HKCR:\Installer\Products")) {
  Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($props.ProductName -eq 'Mythril') { Remove-Item $_.PSPath -Recurse -Force; Write-Host "removed $($_.PSChildName)" }
  }
}

# Leftover app files
Get-Process mythril -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item "C:\Users\Perry\AppData\Local\Mythril" -Recurse -Force -ErrorAction SilentlyContinue

# Fresh install
$msi = "C:\Users\Perry\Documents\Mythril\apps\x\apps\main\release\Mythril-0.2.0.msi"
$p = Start-Process msiexec -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Wait -PassThru
Write-Host "install exit: $($p.ExitCode)"
if ($p.ExitCode -eq 0) { Write-Host "Done — Mythril 0.2.0 installed. Launching…"; Start-Process "C:\Users\Perry\AppData\Local\Mythril\mythril.exe" }
