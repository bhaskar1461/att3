/**
 * Multi-QR Code Decoder Engine
 * Leverages native browser BarcodeDetector API for hardware-accelerated, multi-QR decoding
 * with robust software fallback (decodeFrame / jsQR / WASM) for browsers lacking native support (e.g. iOS Safari, Firefox).
 */

import { decodeFrame } from './qrEngine';

export interface DecodedQRResult {
  rawValue: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  cornerPoints?: Array<{ x: number; y: number }>;
}

declare global {
  interface Window {
    BarcodeDetector?: any;
  }
}

export class MultiQRDecoder {
  private nativeDetector: any = null;
  private isNativeSupported: boolean = false;
  private fallbackCanvas: HTMLCanvasElement | null = null;
  private fallbackCtx: CanvasRenderingContext2D | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        this.nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
        this.isNativeSupported = true;
      } catch {
        this.isNativeSupported = false;
      }
    }
  }

  public get isNative(): boolean {
    return this.isNativeSupported;
  }

  private getImageData(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): ImageData | null {
    if (typeof document === 'undefined') return null;

    const width = 'videoWidth' in source ? source.videoWidth : source.width;
    const height = 'videoHeight' in source ? source.videoHeight : source.height;

    if (!width || !height) return null;

    if (!this.fallbackCanvas) {
      this.fallbackCanvas = document.createElement('canvas');
      this.fallbackCtx = this.fallbackCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (!this.fallbackCtx) return null;

    if (this.fallbackCanvas.width !== width || this.fallbackCanvas.height !== height) {
      this.fallbackCanvas.width = width;
      this.fallbackCanvas.height = height;
    }

    this.fallbackCtx.drawImage(source, 0, 0, width, height);
    return this.fallbackCtx.getImageData(0, 0, width, height);
  }

  /**
   * Detects all QR codes present in an HTMLVideoElement, Canvas, or ImageBitmap.
   * Returns an array of DecodedQRResult containing decoded raw values and bounding boxes.
   * Automatically falls back to decodeFrame (WASM/jsQR) when native BarcodeDetector is absent or returns empty.
   */
  public async detectMulti(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<DecodedQRResult[]> {
    if (this.isNativeSupported && this.nativeDetector) {
      try {
        const barcodes = await this.nativeDetector.detect(source);
        if (barcodes && barcodes.length > 0) {
          return barcodes.map((b: any) => ({
            rawValue: b.rawValue,
            boundingBox: {
              x: b.boundingBox.x,
              y: b.boundingBox.y,
              width: b.boundingBox.width,
              height: b.boundingBox.height,
            },
            cornerPoints: b.cornerPoints || []
          }));
        }
      } catch {
        // Fall back to software decoder if native detector encounters an error
      }
    }

    // Fallback path: Non-BarcodeDetector browsers (e.g. iOS Safari, Firefox)
    try {
      const imgData = this.getImageData(source);
      if (imgData) {
        const decodeRes = await decodeFrame(imgData);
        if (decodeRes.result.ok && decodeRes.result.text) {
          const bbox = decodeRes.result.boundingBox || { x: 0, y: 0, width: 100, height: 100 };
          return [{
            rawValue: decodeRes.result.text,
            boundingBox: {
              x: bbox.x,
              y: bbox.y,
              width: bbox.width || 100,
              height: bbox.height || 100,
            },
            cornerPoints: []
          }];
        }
      }
    } catch {
      // Ignore fallback decode errors
    }

    return [];
  }
}
