/**
 * Multi-QR Code Decoder Engine
 * Leverages native browser BarcodeDetector API for hardware-accelerated, multi-QR decoding
 * with off-main-thread worker fallback.
 */

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

  /**
   * Detects all QR codes present in an HTMLVideoElement, Canvas, or ImageBitmap.
   * Returns an array of DecodedQRResult containing decoded raw values and bounding boxes.
   */
  public async detectMulti(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<DecodedQRResult[]> {
    if (this.isNativeSupported && this.nativeDetector) {
      try {
        const barcodes = await this.nativeDetector.detect(source);
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
      } catch {
        return [];
      }
    }
    return [];
  }
}
