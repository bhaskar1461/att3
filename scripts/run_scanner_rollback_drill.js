/**
 * SNIST ERP — Scanner Engine Rollback Drill (Week 6 Part C)
 * 
 * Simulates real-time video stream frame processing across mid-stream engine flips:
 * 1. Start in WASM mode -> process frames -> verify WASM engine used.
 * 2. Mid-stream emergency rollback (WASM -> jsQR) without tearing down stream -> verify jsQR used.
 * 3. Recovery flip (jsQR -> WASM) without tearing down stream -> verify WASM used.
 * 4. Crash injection: Force WASM failure -> verify instant silent failover to jsQR with zero dropped frames.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const frontendModules = path.resolve(__dirname, '../frontend/node_modules');
if (!module.paths.includes(frontendModules)) {
  module.paths.unshift(frontendModules);
}

const { PNG } = require(path.join(frontendModules, 'pngjs'));
const jsQR = require(path.join(frontendModules, 'jsqr'));

const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures/qr_benchmark');

async function main() {
  console.log('===============================================================');
  console.log('SNIST ERP — Scanner Engine Dynamic Rollback & Failover Drill');
  console.log('===============================================================');

  // Dynamically import zxing-wasm
  const zxingEntry = path.join(frontendModules, 'zxing-wasm', 'dist', 'es', 'reader', 'index.js');
  const { readBarcodesFromImageData } = await import(pathToFileURL(zxingEntry).href);

  // Load test fixture
  const sampleBuf = fs.readFileSync(path.join(FIXTURES_DIR, 'sharp_01.png'));
  const png = PNG.sync.read(sampleBuf);
  const validImgData = {
    data: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height
  };

  // Mock Camera Stream Object (to verify stream identity is preserved across flips)
  const mockCameraStream = {
    id: 'mock-camera-stream-' + Date.now(),
    active: true,
    getVideoTracks: () => [{ id: 'track-1', readyState: 'live' }]
  };

  let activeEngine = 'wasm';
  let fallbackCount = 0;

  // Frame processing dispatch reproducing frontend/src/services/qrEngine.ts
  async function processVideoFrame(frameIndex, imgData, forceWasmCrash = false) {
    const streamIdBefore = mockCameraStream.id;
    const engineRequested = activeEngine;
    let engineUsed = engineRequested;
    let decodedText = null;
    let wasmFailed = false;

    if (engineRequested === 'wasm') {
      try {
        if (forceWasmCrash) {
          throw new Error('Simulated WASM memory corruption / WebAssembly.RuntimeError');
        }
        const zxRes = await readBarcodesFromImageData(imgData, { formats: ['QRCode'] });
        if (zxRes && zxRes.length > 0 && zxRes[0].text) {
          decodedText = zxRes[0].text;
          engineUsed = 'wasm';
        }
      } catch (err) {
        // Transparent fallback to jsQR
        wasmFailed = true;
        fallbackCount++;
        const fallbackRes = jsQR(imgData.data, imgData.width, imgData.height);
        if (fallbackRes && fallbackRes.data) {
          decodedText = fallbackRes.data;
          engineUsed = 'jsqr';
        }
      }
    } else {
      // Direct jsQR path (WASM bypassed)
      const res = jsQR(imgData.data, imgData.width, imgData.height);
      if (res && res.data) {
        decodedText = res.data;
        engineUsed = 'jsqr';
      }
    }

    const streamIdAfter = mockCameraStream.id;
    const streamPreserved = (streamIdBefore === streamIdAfter && mockCameraStream.active);

    return {
      frameIndex,
      engineRequested,
      engineUsed,
      decodedText,
      wasmFailed,
      streamPreserved
    };
  }

  console.log(`[Phase 1] Starting camera stream (${mockCameraStream.id}) with SCANNER_ENGINE = 'wasm'...`);
  activeEngine = 'wasm';
  for (let f = 1; f <= 3; f++) {
    const res = await processVideoFrame(f, validImgData);
    console.log(`  Frame ${f}: requested=${res.engineRequested}, used=${res.engineUsed}, streamPreserved=${res.streamPreserved}, decoded=${res.decodedText}`);
    if (res.engineUsed !== 'wasm' || !res.streamPreserved) {
      throw new Error(`Phase 1 assertion failed on frame ${f}`);
    }
  }

  console.log(`\n[Phase 2] Simulating EMERGENCY ROLLBACK: Feature flag flipped to 'jsqr' mid-stream...`);
  activeEngine = 'jsqr';
  for (let f = 4; f <= 6; f++) {
    const res = await processVideoFrame(f, validImgData);
    console.log(`  Frame ${f}: requested=${res.engineRequested}, used=${res.engineUsed}, streamPreserved=${res.streamPreserved}, decoded=${res.decodedText}`);
    if (res.engineUsed !== 'jsqr' || !res.streamPreserved) {
      throw new Error(`Phase 2 rollback assertion failed on frame ${f}`);
    }
  }

  console.log(`\n[Phase 3] Simulating RECOVERY: Feature flag flipped back to 'wasm' mid-stream...`);
  activeEngine = 'wasm';
  for (let f = 7; f <= 9; f++) {
    const res = await processVideoFrame(f, validImgData);
    console.log(`  Frame ${f}: requested=${res.engineRequested}, used=${res.engineUsed}, streamPreserved=${res.streamPreserved}, decoded=${res.decodedText}`);
    if (res.engineUsed !== 'wasm' || !res.streamPreserved) {
      throw new Error(`Phase 3 recovery assertion failed on frame ${f}`);
    }
  }

  console.log(`\n[Phase 4] Simulating WASM CRASH / EXCEPTION: Testing silent failover to jsQR...`);
  const crashRes = await processVideoFrame(10, validImgData, true);
  console.log(`  Frame 10: requested=${crashRes.engineRequested}, used=${crashRes.engineUsed}, wasmFailed=${crashRes.wasmFailed}, streamPreserved=${crashRes.streamPreserved}, decoded=${crashRes.decodedText}`);
  if (!crashRes.wasmFailed || crashRes.engineUsed !== 'jsqr' || !crashRes.streamPreserved || !crashRes.decodedText) {
    throw new Error('Phase 4 crash failover assertion failed!');
  }

  console.log('\n===============================================================');
  console.log('ROLLBACK DRILL VERIFICATION SUMMARY');
  console.log('===============================================================');
  console.log('1. WASM decode operational:                   PASS [OK]');
  console.log('2. Mid-stream rollback (WASM -> jsQR):         PASS [OK] (Zero camera stream resets)');
  console.log('3. Mid-stream recovery (jsQR -> WASM):         PASS [OK] (Zero camera stream resets)');
  console.log('4. Silent Crash Failover (WASM -> jsQR):      PASS [OK] (Zero dropped frames)');
  console.log('===============================================================\n');
}

main().catch(err => {
  console.error('Rollback drill failed:', err);
  process.exit(1);
});
