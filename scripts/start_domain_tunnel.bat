@echo off
echo ===================================================
echo Starting Cloudflare Quick Tunnel for SNIST Attendance
echo ===================================================
set PORT=%1
if "%PORT%"=="" set PORT=8080
echo Binding Local Port %PORT% (Unified App & API Proxy)...
if not "%TUNNEL_TOKEN%"=="" (
    echo Starting Named Cloudflare Tunnel using TUNNEL_TOKEN...
    cloudflared.exe tunnel run --token %TUNNEL_TOKEN%
) else (
    echo Starting Normal Quick Cloudflare Tunnel on http://localhost:%PORT%...
    cloudflared.exe tunnel --protocol http2 --url http://localhost:%PORT%
)
