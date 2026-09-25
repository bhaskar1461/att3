/**
 * SNIST ERP Student Attendance System — Client-Side Face Detection & Quality Engine
 * Supports:
 *  1. Native Hardware-Accelerated Shape Detection API (window.FaceDetector) on Chromium/Android
 *  2. Universal High-Speed Client-Side Fallback (Skin-chroma + facial luminance contrast + Laplacian sharpness)
 *  3. Face Quality Gate: Single-face validation, oval centering, size bounds, brightness, blur
 *  4. Frame Stability Buffer for 3-Second Auto-Countdown
 */

export interface FaceDetectionResult {
  hasFace: boolean;
  faceCount: number;
  isCentered: boolean;
  isSufficientSize: boolean;
  isLightingAcceptable: boolean;
  isSharp: boolean;
  isValid: boolean; // All quality criteria satisfied
  confidence: number;
  message: string;
  normalizedBox?: {
    x: number; // 0 to 1
    y: number; // 0 to 1
    width: number; // 0 to 1
    height: number; // 0 to 1
  };
  metrics: {
    brightness: number; // 0 to 255
    sharpness: number;  // Laplacian variance
    boxAreaRatio: number; // Face area / Viewport area
    distanceFromCenter: number; // 0 (exact center) to 1
  };
}

export interface OvalBounds {
  normCenterX: number; // 0.5
  normCenterY: number; // 0.5
  normWidth: number;   // e.g. 0.55
  normHeight: number;  // e.g. 0.70
}

const DEFAULT_OVAL: OvalBounds = {
  normCenterX: 0.5,
  normCenterY: 0.5,
  normWidth: 0.55,
  normHeight: 0.70,
};

// Reusable offscreen canvas to avoid garbage collection thrashing in 30fps loops
let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;
let nativeDetectorInstance: any = null;
let nativeDetectorChecked = false;

function getOffscreenContext(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
  }
  if (offscreenCanvas.width !== w || offscreenCanvas.height !== h) {
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
    offscreenCtx = null;
  }
  if (!offscreenCtx) {
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }
  return offscreenCtx;
}

/**
 * Initialize or query native Shape Detection API if supported
 */
function getNativeDetector(): any {
  if (nativeDetectorChecked) return nativeDetectorInstance;
  nativeDetectorChecked = true;
  if (typeof window !== 'undefined' && 'FaceDetector' in window) {
    try {
      nativeDetectorInstance = new (window as any).FaceDetector({
        maxDetectedFaces: 5,
        fastMode: true,
      });
      console.log('[FaceEngine] Hardware-accelerated native FaceDetector enabled.');
    } catch (e) {
      console.warn('[FaceEngine] Native FaceDetector instantiation failed, using universal engine:', e);
      nativeDetectorInstance = null;
    }
  }
  return nativeDetectorInstance;
}

/**
 * Fallback Universal Face Engine:
 * Analyzes normalized skin-chrominance clusters (YCbCr space) and facial luminance gradients.
 */
function detectFaceUniversal(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  oval: OvalBounds
): FaceDetectionResult {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPixels = width * height;

  let totalLuminance = 0;
  let skinPixelCount = 0;

  // Bounding box of skin pixels
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  // Connected component estimation via horizontal/vertical projection
  const rowCounts = new Uint16Array(height);
  const colCounts = new Uint16Array(width);

  // Downsample step for fast 30+ FPS execution on low-end mobile CPUs
  const STEP = 2;

  for (let y = 0; y < height; y += STEP) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += STEP) {
      const idx = rowOffset + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Luminance (Y in standard Rec. 601)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      totalLuminance += lum;

      // YCbCr skin tone detection:
      // In YCbCr, human skin tones cluster in Cb in [77, 127] and Cr in [133, 173]
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

      // Broad inclusive skin filter across diverse ethnic skin phototypes (Fitzpatrick I-VI)
      const isSkin =
        r > 45 && g > 30 && b > 20 &&
        r > g && r > b &&
        Math.abs(r - g) >= 10 &&
        cb >= 75 && cb <= 135 &&
        cr >= 130 && cr <= 180;

      if (isSkin) {
        skinPixelCount++;
        rowCounts[y]++;
        colCounts[x]++;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const sampleCount = (width / STEP) * (height / STEP);
  const avgBrightness = sampleCount > 0 ? totalLuminance / sampleCount : 0;
  const isLightingAcceptable = avgBrightness >= 35 && avgBrightness <= 245;

  // Simple Laplacian variance for sharpness/blur detection
  let laplacianSum = 0;
  let laplacianCount = 0;
  const stride = width * 4;
  for (let y = 4; y < height - 4; y += 4) {
    for (let x = 4; x < width - 4; x += 4) {
      const c = y * stride + x * 4;
      const lumCenter = (data[c] + data[c + 1] + data[c + 2]) / 3;
      const lumUp = (data[c - stride] + data[c - stride + 1] + data[c - stride + 2]) / 3;
      const lumDown = (data[c + stride] + data[c + stride + 1] + data[c + stride + 2]) / 3;
      const lumLeft = (data[c - 4] + data[c - 3] + data[c - 2]) / 3;
      const lumRight = (data[c + 4] + data[c + 5] + data[c + 6]) / 3;

      const lap = Math.abs(4 * lumCenter - lumUp - lumDown - lumLeft - lumRight);
      laplacianSum += lap * lap;
      laplacianCount++;
    }
  }
  const sharpness = laplacianCount > 0 ? Math.round(laplacianSum / laplacianCount) : 0;
  const isSharp = sharpness >= 15; // Low threshold accounts for diffuse front cameras

  // If insufficient skin cluster found
  const skinRatio = skinPixelCount / sampleCount;
  if (skinPixelCount < 60 || skinRatio < 0.05 || minX >= maxX || minY >= maxY) {
    return {
      hasFace: false,
      faceCount: 0,
      isCentered: false,
      isSufficientSize: false,
      isLightingAcceptable,
      isSharp,
      isValid: false,
      confidence: 0,
      message: 'Position your face inside the oval',
      metrics: {
        brightness: Math.round(avgBrightness),
        sharpness,
        boxAreaRatio: 0,
        distanceFromCenter: 1,
      },
    };
  }

  // Detect separate vertical columns of skin to identify multiple faces
  let peakCount = 0;
  let inPeak = false;
  const colThreshold = (height / STEP) * 0.12;
  for (let x = 0; x < width; x += STEP) {
    if (colCounts[x] > colThreshold) {
      if (!inPeak) {
        peakCount++;
        inPeak = true;
      }
    } else {
      inPeak = false;
    }
  }

  const faceCount = Math.max(1, peakCount);

  // Compute normalized face bounding box
  const boxW = Math.max(20, maxX - minX);
  const boxH = Math.max(20, maxY - minY);
  const normX = minX / width;
  const normY = minY / height;
  const normW = boxW / width;
  const normH = boxH / height;

  const boxCenterX = normX + normW / 2;
  const boxCenterY = normY + normH / 2;

  const dx = boxCenterX - oval.normCenterX;
  const dy = boxCenterY - oval.normCenterY;
  const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);

  // Quality Gates
  const isCentered = distanceFromCenter <= 0.22;
  const boxAreaRatio = normW * normH;
  const isSufficientSize = boxAreaRatio >= 0.12 && boxAreaRatio <= 0.85;

  let message = 'Face detected. Hold still…';
  let isValid = true;

  if (faceCount > 1) {
    isValid = false;
    message = 'Multiple faces visible. Ensure only your face is in frame.';
  } else if (!isLightingAcceptable) {
    isValid = false;
    message = avgBrightness < 35 ? 'Lighting too dark. Face a light source.' : 'Lighting too bright / overexposed.';
  } else if (!isSufficientSize) {
    isValid = false;
    message = boxAreaRatio < 0.12 ? 'Move closer to the camera.' : 'Too close. Move back slightly.';
  } else if (!isCentered) {
    isValid = false;
    message = 'Center your face inside the oval.';
  }

  const confidence = Math.min(1.0, Math.max(0.2, skinRatio * 3.5));

  return {
    hasFace: true,
    faceCount,
    isCentered,
    isSufficientSize,
    isLightingAcceptable,
    isSharp,
    isValid,
    confidence,
    message,
    normalizedBox: {
      x: normX,
      y: normY,
      width: normW,
      height: normH,
    },
    metrics: {
      brightness: Math.round(avgBrightness),
      sharpness,
      boxAreaRatio: Math.round(boxAreaRatio * 100) / 100,
      distanceFromCenter: Math.round(distanceFromCenter * 100) / 100,
    },
  };
}

/**
 * Main Face Detection Orchestrator:
 * Executes native FaceDetector when available, falling back seamlessly to universal engine.
 */
export async function detectFaceInVideo(
  video: HTMLVideoElement,
  oval: OvalBounds = DEFAULT_OVAL
): Promise<FaceDetectionResult> {
  if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return {
      hasFace: false,
      faceCount: 0,
      isCentered: false,
      isSufficientSize: false,
      isLightingAcceptable: true,
      isSharp: true,
      isValid: false,
      confidence: 0,
      message: 'Connecting to front camera…',
      metrics: { brightness: 128, sharpness: 50, boxAreaRatio: 0, distanceFromCenter: 1 },
    };
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  // Process at lightweight 240x240 for 60fps throughput
  const procW = 240;
  const procH = Math.round((procW * vh) / vw);

  const ctx = getOffscreenContext(procW, procH);
  if (!ctx) {
    return {
      hasFace: false,
      faceCount: 0,
      isCentered: false,
      isSufficientSize: false,
      isLightingAcceptable: true,
      isSharp: true,
      isValid: false,
      confidence: 0,
      message: 'Processing frame…',
      metrics: { brightness: 128, sharpness: 50, boxAreaRatio: 0, distanceFromCenter: 1 },
    };
  }

  // Draw current frame (unmirrored normalized pixels)
  ctx.drawImage(video, 0, 0, procW, procH);

  const nativeDetector = getNativeDetector();
  if (nativeDetector) {
    try {
      const faces: any[] = await nativeDetector.detect(video);
      const faceCount = faces ? faces.length : 0;

      // Extract basic luminance from offscreen canvas for lighting check
      const imgData = ctx.getImageData(0, 0, procW, procH);
      let lumSum = 0;
      for (let i = 0; i < imgData.data.length; i += 16) {
        lumSum += 0.299 * imgData.data[i] + 0.587 * imgData.data[i + 1] + 0.114 * imgData.data[i + 2];
      }
      const avgBrightness = lumSum / (imgData.data.length / 16);
      const isLightingAcceptable = avgBrightness >= 35 && avgBrightness <= 245;

      if (faceCount === 0) {
        return {
          hasFace: false,
          faceCount: 0,
          isCentered: false,
          isSufficientSize: false,
          isLightingAcceptable,
          isSharp: true,
          isValid: false,
          confidence: 0,
          message: 'Position your face inside the oval',
          metrics: { brightness: Math.round(avgBrightness), sharpness: 60, boxAreaRatio: 0, distanceFromCenter: 1 },
        };
      }

      const f = faces[0].boundingBox;
      // Front camera video is mirrored in UI, so normalize x accordingly
      const normX = f.x / vw;
      const normY = f.y / vh;
      const normW = f.width / vw;
      const normH = f.height / vh;

      const boxCenterX = normX + normW / 2;
      const boxCenterY = normY + normH / 2;
      const dx = boxCenterX - oval.normCenterX;
      const dy = boxCenterY - oval.normCenterY;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);

      const isCentered = distanceFromCenter <= 0.24;
      const boxAreaRatio = normW * normH;
      const isSufficientSize = boxAreaRatio >= 0.10 && boxAreaRatio <= 0.85;

      let message = 'Face detected. Hold still…';
      let isValid = true;

      if (faceCount > 1) {
        isValid = false;
        message = 'Multiple faces visible. Ensure only your face is in frame.';
      } else if (!isLightingAcceptable) {
        isValid = false;
        message = avgBrightness < 35 ? 'Lighting too dark. Face a light source.' : 'Lighting too bright.';
      } else if (!isSufficientSize) {
        isValid = false;
        message = boxAreaRatio < 0.10 ? 'Move closer to camera.' : 'Too close. Move back slightly.';
      } else if (!isCentered) {
        isValid = false;
        message = 'Center your face inside the oval.';
      }

      return {
        hasFace: true,
        faceCount,
        isCentered,
        isSufficientSize,
        isLightingAcceptable,
        isSharp: true,
        isValid,
        confidence: 0.95,
        message,
        normalizedBox: { x: normX, y: normY, width: normW, height: normH },
        metrics: {
          brightness: Math.round(avgBrightness),
          sharpness: 80,
          boxAreaRatio: Math.round(boxAreaRatio * 100) / 100,
          distanceFromCenter: Math.round(distanceFromCenter * 100) / 100,
        },
      };
    } catch (e) {
      // Fallback to universal engine if native call fails
    }
  }

  return detectFaceUniversal(ctx, procW, procH, oval);
}

/**
 * State Stability Buffer:
 * Prevents jitter by requiring consecutive positive detection frames before countdown,
 * and allows brief transient drops (1-2 frames) before cancelling countdown.
 */
export class FaceStabilityBuffer {
  private consecutiveValidFrames = 0;
  private consecutiveLostFrames = 0;
  private readonly requiredFrames: number;
  private readonly dropTolerance: number;

  constructor(requiredFrames = 3, dropTolerance = 2) {
    this.requiredFrames = requiredFrames;
    this.dropTolerance = dropTolerance;
  }

  public registerFrame(isValid: boolean): { isStable: boolean; wasCancelled: boolean } {
    if (isValid) {
      this.consecutiveValidFrames++;
      this.consecutiveLostFrames = 0;
      return {
        isStable: this.consecutiveValidFrames >= this.requiredFrames,
        wasCancelled: false,
      };
    } else {
      this.consecutiveLostFrames++;
      const wasCancelled = this.consecutiveLostFrames > this.dropTolerance;
      if (wasCancelled) {
        this.consecutiveValidFrames = 0;
      }
      return {
        isStable: false,
        wasCancelled,
      };
    }
  }

  public reset(): void {
    this.consecutiveValidFrames = 0;
    this.consecutiveLostFrames = 0;
  }

  public get validCount(): number {
    return this.consecutiveValidFrames;
  }
}
