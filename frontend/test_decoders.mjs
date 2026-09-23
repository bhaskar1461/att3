import fs from 'fs';
import jsQR from 'jsqr';
import { readBarcodes } from 'zxing-wasm/reader';

async function main() {
  const buf = fs.readFileSync('../exact_snist_qr_perfect.png');
  console.log('File size:', buf.length);
  try {
    const results = await readBarcodes(buf);
    console.log('zxing-wasm results:', results);
  } catch (err) {
    console.error('zxing-wasm error:', err);
  }
}

main();

