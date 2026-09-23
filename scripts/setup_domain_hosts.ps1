# PowerShell script to safely map whiteleos.cc.cd to 127.0.0.1 in Windows hosts file
$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
$domain = "whiteleos.cc.cd"
$ip = "127.0.0.1"
$entry = "$ip $domain"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Windows Hosts Configuration for Domain: $domain" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$content = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue

if ($content -match "\b$domain\b") {
    Write-Host "[OK] Domain $domain is already mapped in $hostsPath" -ForegroundColor Green
    exit 0
}

# Check for Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    Write-Host "[+] Adding '$entry' to $hostsPath..." -ForegroundColor Yellow
    Add-Content -Path $hostsPath -Value "`n$entry" -Encoding ascii
    Write-Host "[SUCCESS] Added '$entry' to $hostsPath!" -ForegroundColor Green
} else {
    Write-Host "[!] Administrative privileges required to edit $hostsPath" -ForegroundColor Yellow
    Write-Host "[*] Requesting UAC elevation to apply mapping..." -ForegroundColor Cyan
    $scriptBlock = "Add-Content -Path '$hostsPath' -Value '`n$entry' -Encoding ascii"
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile", "-Command", $scriptBlock -Wait
    
    # Verify
    $verifyContent = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
    if ($verifyContent -match "\b$domain\b") {
        Write-Host "[SUCCESS] Domain $domain was successfully mapped to $ip!" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] Could not verify hosts update. Please run PowerShell as Administrator and run:" -ForegroundColor Red
        Write-Host "Add-Content -Path 'C:\Windows\System32\drivers\etc\hosts' -Value '`n$entry'" -ForegroundColor White
    }
}
