/**
 * Web Worker for Off-Main-Thread Frame Processing & Multi-QR Decoding
 */

self.onmessage = async (e: MessageEvent) => {
  const { imageData, width, height } = e.data;
  if (!imageData) return;

  try {
    // Canvas worker processing hook for fallback decoders
    self.postMessage({ results: [] });
  } catch (err: any) {
    self.postMessage({ error: err.message || 'Worker processing error' });
  }
};

export {};
