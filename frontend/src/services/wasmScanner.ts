/**
 * SNIST ERP — zxing-cpp WebAssembly Scanner Harness
 * Week 6: Part 1 of Two-Week Scanner Engine Swap
 *
 * PRIME DIRECTIVE: Thin, typed wrapper around zxing-cpp WebAssembly.
 * - Zero CDN runtime dependency: loads /wasm/zxing_reader.wasm from local origin.
 * - Safe memory lifecycle: memory managed with guaranteed garbage collection.
 * - Multi-QR detection: reports candidate count to feed anti-relay protection.
 * - High-precision telemetry: measures exact WASM execution duration (ms_taken).
 */

import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';

export interface DecodeHints {
  tryHarder?: boolean;
  tryRotate?: boolean;
  tryInvert?: boolean;
  formats?: string[];
  maxSymbols?: number;
}

export type DecodeResult =
  | {
      ok: true;
      text: string;
      format: string;
      ms_taken: number;
      candidateCount: number;
      boundingBox?: { x: number; y: number; width: number; height: number };
      error?: undefined;
    }
  | {
      ok: false;
      ms_taken: number;
      candidateCount: number;
      error?: string;
    };

let isWasmPrepared = false;
let isWasmReady = false;
let wasmInitPromise: Promise<boolean> | null = null;

/**
 * Returns whether the WebAssembly scanner runtime is fully compiled and ready.
 */
export function isWasmScannerReady(): boolean {
  return isWasmReady;
}

/**
 * Initializes and eagerly compiles the WASM module with local origin overrides.
 * Guarantees zero third-party CDN hits at 9:50 AM classroom peak.
 * Includes a defensive timeout (3500ms) to ensure slow phones/networks fail fast to jsQR.
 */
export async function initWasmScanner(timeoutMs: number = 3500): Promise<boolean> {
  if (isWasmReady) return true;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      if (typeof window === 'undefined' || !('WebAssembly' in window)) {
        throw new Error('WebAssembly not supported in this environment');
      }

      console.log('[WasmScanner] Pre-warming WebAssembly scanner runtime (/wasm/zxing_reader.wasm)...');

      // Configure module to load local repo-checked-in wasm artifact with eager compilation
      const modulePromise = prepareZXingModule({
        overrides: {
          locateFile: (fileName: string) => {
            return `/wasm/${fileName}`;
          }
        },
        fireImmediately: true
      });

      // Defensive timeout: if WASM download/instantiation stalls > timeoutMs, fail fast to jsQR
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`WASM load timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer === 'object' && 'unref' in timer) {
          (timer as any).unref();
        }
      });

      await Promise.race([modulePromise, timeoutPromise]);

      isWasmPrepared = true;
      isWasmReady = true;
      console.log('[WasmScanner] WebAssembly runtime successfully compiled & ready');
      return true;
    } catch (err: any) {
      console.warn('[WasmScanner] Failed to prepare WebAssembly runtime:', err?.message || err);
      isWasmPrepared = false;
      isWasmReady = false;
      throw err;
    } finally {
      wasmInitPromise = null;
    }
  })();

  return wasmInitPromise;
}

/**
 * Decodes a single video frame buffer via zxing-cpp WASM.
 *
 * @param imageData - Raw canvas ImageData buffer
 * @param hints - Optional decoding hints
 * @returns Standardized DecodeResult
 */
export async function decodeFrameWasm(
  imageData: ImageData,
  hints?: DecodeHints
): Promise<DecodeResult> {
  if (!imageData || !imageData.data || imageData.width <= 0 || imageData.height <= 0 || imageData.data.length === 0) {
    return {
      ok: false,
      ms_taken: 0,
      candidateCount: 0,
      error: 'invalid_image_data'
    };
  }

  const startTime = performance.now();

  try {
    if (!isWasmReady) {
      await initWasmScanner();
    }

    const formats = (hints?.formats && hints.formats.length > 0)
      ? (hints.formats as any)
      : ['QRCode'];

    const results = await readBarcodes(imageData, {
      formats,
      tryHarder: hints?.tryHarder ?? true,
      tryRotate: hints?.tryRotate ?? true,
      tryInvert: hints?.tryInvert ?? false,
      maxNumberOfSymbols: hints?.maxSymbols ?? 4
    });

    const elapsed = Math.max(0.1, performance.now() - startTime);

    if (results && results.length > 0) {
      const primary = results[0];
      let boundingBox: { x: number; y: number; width: number; height: number } | undefined;

      if (primary.position) {
        const p = primary.position;
        const minX = Math.min(p.topLeft.x, p.bottomLeft.x, p.topRight.x, p.bottomRight.x);
        const maxX = Math.max(p.topLeft.x, p.bottomLeft.x, p.topRight.x, p.bottomRight.x);
        const minY = Math.min(p.topLeft.y, p.bottomLeft.y, p.topRight.y, p.bottomRight.y);
        const maxY = Math.max(p.topLeft.y, p.bottomLeft.y, p.topRight.y, p.bottomRight.y);
        boundingBox = {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY)
        };
      }

      return {
        ok: true,
        text: primary.text,
        format: primary.format,
        ms_taken: Math.round(elapsed * 100) / 100,
        candidateCount: results.length,
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
      error: err?.message || 'WASM decode failed'
    };
  }
}
