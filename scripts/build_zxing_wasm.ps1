# ==============================================================================
# SNIST ERP — zxing-cpp WASM Module Reproducible Build Script (PowerShell)
# Pinned Toolchain: Emscripten SDK 3.1.56, zxing-cpp v2.2.1
# Output: frontend/public/wasm/zxing_reader.wasm, zxing_reader.js
# ==============================================================================
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$outputDir = Join-Path $rootDir "frontend\public\wasm"

if (!(Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

Write-Host "=== Building zxing-cpp WASM via Docker (Emscripten 3.1.56) ===" -ForegroundColor Cyan
docker build -t snist-zxing-wasm-builder -f "$scriptDir\Dockerfile.zxing_wasm" "$scriptDir"

Write-Host "=== Extracting compiled WASM artifacts to $outputDir ===" -ForegroundColor Cyan
docker run --rm -v "${outputDir}:/out" snist-zxing-wasm-builder

Write-Host "=== Build Complete. Artifact sizes: ===" -ForegroundColor Green
Get-ChildItem -Path $outputDir | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
