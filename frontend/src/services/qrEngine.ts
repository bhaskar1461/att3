/**
 * SNIST ERP — QR Scanner Engine Abstraction Layer
 * Week 6: Part 1 of Two-Week Scanner Engine Swap
 *
 * PRIME DIRECTIVE:
 * - Existing jsQR path remains the DEFAULT ('jsqr').
 * - WASM ships behind SCANNER_ENGINE = jsqr | wasm.
 * - Crash isolation: WASM load/compile failure -> automatic fallback to jsQR + engine_fallback telemetry.
 * - Zero student impact: student always experiences a functional scanner.
 */

import jsQR from 'jsqr';
import { decodeFrameWasm, isWasmScannerReady, initWasmScanner, DecodeHints, DecodeResult } from './wasmScanner';

export type ScannerEngine = 'jsqr' | 'wasm';

export interface QrEngineConfig {
  activeEngine: ScannerEngine;
  source: 'default' | 'local_override' | 'url_param' | 'server_config';
  hasWasmFallbackOccurred: boolean;
}

export type FallbackListener = (detail: { error: string; action: string; fallbackEngine: ScannerEngine }) => void;
const fallbackListeners: FallbackListener[] = [];

type TelemetryHandler = (event: string, details?: any) => void;
let telemetryHandler: TelemetryHandler = () => {};

export function registerTelemetry(fn: TelemetryHandler): void {
  telemetryHandler = fn;
}

export function onScannerFallback(listener: FallbackListener): () => void {
  fallbackListeners.push(listener);
  return () => {
    const idx = fallbackListeners.indexOf(listener);
    if (idx !== -1) fallbackListeners.splice(idx, 1);
  };
}

// Runtime singleton state (Week 8: wasm flipped to default per W7 pre-registered GO verdict)
let currentEngine: ScannerEngine = 'wasm';
let engineConfigResolved = false;
let wasmFailedPermanently = false;

/**
 * Resolves the active scanner engine according to priority:
 * 1. URL Query Param: ?engine=wasm | ?engine=jsqr (dev drill / instant rollback testing)
 * 2. LocalStorage override: snist_scanner_engine ('jsqr' for device rollback)
 * 3. Server-provided runtime config (/api/v1/telemetry/scanner-config)
 * 4. System Default: 'wasm' (Week 8: wasm default; jsQR remains instant-rollback)
 */
export function getActiveScannerEngine(): ScannerEngine {
  if (wasmFailedPermanently) {
    return 'jsqr';
  }

  if (typeof window !== 'undefined') {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlEngine = urlParams.get('engine')?.toLowerCase();
      if (urlEngine === 'wasm' || urlEngine === 'jsqr') {
        return urlEngine as ScannerEngine;
      }

      const localOverride = localStorage.getItem('snist_scanner_engine')?.toLowerCase();
      if (localOverride === 'wasm' || localOverride === 'jsqr') {
        return localOverride as ScannerEngine;
      }
    } catch {}
  }

  return currentEngine;
}

/**
 * Updates the runtime scanner engine dynamically (e.g. from server feature flag or rollback drill).
 */
export function setScannerEngine(engine: ScannerEngine) {
  currentEngine = engine;
  console.log(`[QREngine] Active scanner engine set to: ${engine}`);
}

/**
 * Fetches the server-authoritative feature flag for SCANNER_ENGINE.
 */
export async function syncScannerEngineFromServer(): Promise<ScannerEngine> {
  try {
    const res = await fetch('/api/v1/telemetry/scanner-config', {
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.engine === 'wasm' || data.engine === 'jsqr')) {
        currentEngine = data.engine;
        engineConfigResolved = true;
        return currentEngine;
      }
    }
  } catch (e) {
    // Non-fatal: retains current engine (default: jsqr)
  }
  return currentEngine;
}

/**
 * Decodes using jsQR synchronously with high-resolution performance timing.
 */
function decodeWithJsQr(imageData: ImageData): DecodeResult {
  const startTime = performance.now();
  // Part B.4: Defensive input guard against corrupt/empty buffers
  if (!imageData || !imageData.data || imageData.width <= 0 || imageData.height <= 0 || imageData.data.length === 0) {
    return {
      ok: false,
      ms_taken: 0.1,
      candidateCount: 0,
      error: 'invalid_image_data'
    };
  }

  try {
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    });
    const elapsed = Math.max(0.1, performance.now() - startTime);

    if (code && code.data) {
      let boundingBox: { x: number; y: number; width: number; height: number } | undefined;
      if (code.location) {
        const minX = Math.min(code.location.topLeftCorner.x, code.location.bottomLeftCorner.x);
        const maxX = Math.max(code.location.topRightCorner.x, code.location.bottomRightCorner.x);
        const minY = Math.min(code.location.topLeftCorner.y, code.location.topRightCorner.y);
        const maxY = Math.max(code.location.bottomLeftCorner.y, code.location.bottomRightCorner.y);
        boundingBox = {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY)
        };
      }

      return {
        ok: true,
        text: code.data,
        format: 'QRCode',
        ms_taken: Math.round(elapsed * 100) / 100,
        candidateCount: 1,
        boundingBox
      };
    }

    return {
      ok: false,
      ms_taken: Math.round(elapsed * 100) / 100,
      candidateCount: 0
    };
  } catch (err: any) {
    const elapsed = Math.max(0.1, performance.now() - startTime);
    return {
      ok: false,
      ms_taken: Math.round(elapsed * 100) / 100,
      candidateCount: 0,
      error: err?.message || 'jsQR execution error'
    };
  }
}

/**
 * Unified frame decoder dispatch function.
 * Automatically handles engine selection, execution, and crash-isolated fallback.
 */
export async function decodeFrame(
  imageData: ImageData,
  preferredEngine?: ScannerEngine,
  hints?: DecodeHints
): Promise<{ result: DecodeResult; usedEngine: ScannerEngine; fallbackOccurred: boolean }> {
  const engineToUse = preferredEngine || getActiveScannerEngine();

  // Part B.4: Defensive validation on incoming buffer
  if (!imageData || !imageData.data || imageData.width <= 0 || imageData.height <= 0 || imageData.data.length === 0) {
    return {
      result: {
        ok: false,
        ms_taken: 0.1,
        candidateCount: 0,
        error: 'invalid_image_data'
      },
      usedEngine: engineToUse,
      fallbackOccurred: false
    };
  }

  // Path 1: jsQR (Default / Rollback / Failover)
  if (engineToUse === 'jsqr' || wasmFailedPermanently) {
    const res = decodeWithJsQr(imageData);
    return { result: res, usedEngine: 'jsqr', fallbackOccurred: false };
  }

  // Part B.5: Non-blocking WASM readiness guard
  // If WASM is still downloading or compiling during camera warmup, decode this frame with jsQR
  // so the camera never freezes and no frame is dropped while WASM finishes initializing.
  if (!isWasmScannerReady()) {
    const jsQrRes = decodeWithJsQr(imageData);
    if (jsQrRes.ok) {
      return { result: jsQrRes, usedEngine: 'jsqr', fallbackOccurred: false };
    }
    // Eagerly kick off or await WASM initialization in the background
    try {
      await initWasmScanner();
    } catch (initErr: any) {
      console.warn('[QREngine] WASM pre-warm failed. Tripping automatic jsQR fallback:', initErr?.message || initErr);
      wasmFailedPermanently = true;
      return { result: jsQrRes, usedEngine: 'jsqr', fallbackOccurred: true };
    }
  }

  // Path 2: WASM (Behind feature flag)
  try {
    const res = await decodeFrameWasm(imageData, hints);

    // If WASM errored internally (e.g. out of bounds / memory issue), trigger fallback
    if (!res.ok && res.error) {
      throw new Error(res.error);
    }

    return { result: res, usedEngine: 'wasm', fallbackOccurred: false };
  } catch (err: any) {
    // CRASH ISOLATION: WASM load/compile failure -> automatic jsQR fallback
    console.warn('[QREngine] WASM decode failed. Tripping automatic jsQR fallback:', err?.message || err);
    wasmFailedPermanently = true;

    // Notify fallback listeners (e.g. telemetry) without circular imports
    for (const listener of fallbackListeners) {
      try {
        listener({
          error: err?.message || 'WASM initialization/decode crash',
          action: 'AUTOMATIC_FALLBACK_TO_JSQR',
          fallbackEngine: 'jsqr'
        });
      } catch {}
    }

    // Immediate seamless failover to jsQR
    const fallbackRes = decodeWithJsQr(imageData);
    return { result: fallbackRes, usedEngine: 'jsqr', fallbackOccurred: true };
  }
}
