@echo off
title Trust SSL Certificate for whiteleos.cc.cd
cd /d "%~dp0.."

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Requesting Administrator privileges to install trusted certificate...
    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/k', '\"%~dpnx0\"' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   Installing SSL Certificate for whiteleos.cc.cd into Windows
echo ============================================================
echo.

certutil -addstore -f Root "C:\Users\bhask\Desktop\att2\certs\cert.crt"

if %errorLevel% equ 0 (
    echo.
    echo ============================================================
    echo [SUCCESS] Certificate is now TRUSTED by Windows!
    echo.
    echo Close and re-open Brave / Chrome, then visit:
    echo https://whiteleos.cc.cd
    echo ============================================================
) else (
    echo.
    echo [ERROR] Failed to install certificate into Trusted Root store.
)

echo.
pause
