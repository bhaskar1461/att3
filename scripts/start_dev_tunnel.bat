@echo off
REM ==============================================================================
REM SNIST Attendance ERP — Start Shareable Dev Tunnel (dev-ather-os.de5.net)
REM Points to Local Vite Dev Server (http://localhost:5173)
REM ==============================================================================

echo [Dev Tunnel] Checking for cloudflared binary...
set CF_BIN=cloudflared
if exist "%~dp0..\cloudflared.exe" (
    set CF_BIN="%~dp0..\cloudflared.exe"
)

echo [Dev Tunnel] Using binary: %CF_BIN%
echo.
echo ==============================================================================
echo  DEV TUNNEL SAFETY NOTICE:
echo  - Target: dev-ather-os.de5.net -^> http://localhost:5173
echo  - dev-ather-os.de5.net must be PROTECTED via Cloudflare Zero Trust Access
echo    or kept down when not in use.
echo  - NEVER point this tunnel at production databases or production servers.
echo ==============================================================================
echo.

if "%~1"=="" goto check_named_tunnel
echo [Dev Tunnel] Starting tunnel with provided token...
%CF_BIN% tunnel run --token %1
goto end

:check_named_tunnel
if exist "%~dp0cloudflared_dev_tunnel.yml" (
    echo [Dev Tunnel] Starting named tunnel using scripts/cloudflared_dev_tunnel.yml...
    %CF_BIN% tunnel --config "%~dp0cloudflared_dev_tunnel.yml" run snist-dev-tunnel
) else (
    echo [Dev Tunnel] Running quick tunnel to http://localhost:5173...
    %CF_BIN% tunnel --url http://localhost:5173
)

:end
