import { readBarcodes } from 'zxing-wasm/reader';
import jsQR from 'jsqr';
import fs from 'fs';

const width = 1000;
const height = 1000;
const raw = fs.readFileSync('qr_rgba.bin');
const data = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength);

console.log('Testing jsQR on 1000x1000 RGBA...');
const t0 = performance.now();
const jsqrRes = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
console.log('jsQR time:', (performance.now() - t0).toFixed(1) + 'ms, text:', jsqrRes?.data);

console.log('Testing zxing-wasm on 1000x1000 RGBA...');
const t1 = performance.now();
const zxRes = await readBarcodes({ data, width, height });
console.log('zxing-wasm time:', (performance.now() - t1).toFixed(1) + 'ms, text:', zxRes[0]?.text);

