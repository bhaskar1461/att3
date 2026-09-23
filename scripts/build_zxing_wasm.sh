#!/usr/bin/env bash
# ==============================================================================
# SNIST ERP — zxing-cpp WASM Module Reproducible Build Script (Week 6)
# Pinned Toolchain: Emscripten SDK 3.1.56, zxing-cpp v2.2.1
# Output: frontend/public/wasm/zxing_reader.wasm, zxing_reader.js
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$ROOT_DIR/frontend/public/wasm"

mkdir -p "$OUTPUT_DIR"

echo "=== Building zxing-cpp WASM via Docker (Emscripten 3.1.56) ==="
docker build -t snist-zxing-wasm-builder -f "$SCRIPT_DIR/Dockerfile.zxing_wasm" "$SCRIPT_DIR"

echo "=== Extracting compiled WASM artifacts to $OUTPUT_DIR ==="
docker run --rm -v "$OUTPUT_DIR:/out" snist-zxing-wasm-builder

echo "=== Build Complete. Artifact sizes: ==="
ls -lh "$OUTPUT_DIR"
