import type { MethodSplitResult } from '../overview/selectors';

export interface MethodPercents {
  qr: number;
  face: number;
  kiosk: number;
  manual: number;
  sum: number;
}

/**
 * Largest-Remainder Method (Hare-Niemeyer) for percentage calculation.
 * Ensures the split sum rounds to exactly 100.0% when counts exist.
 */
export function percentSplit(methodCounts: MethodSplitResult | undefined | null): MethodPercents {
  if (!methodCounts) {
    return { qr: 0, face: 0, kiosk: 0, manual: 0, sum: 0 };
  }

  const keys: Array<keyof MethodSplitResult> = ['qr', 'face', 'kiosk', 'manual'];
  const counts = keys.map((k) => Math.max(0, methodCounts[k] || 0));
  const total = counts.reduce((acc, c) => acc + c, 0);

  if (total === 0) {
    return { qr: 0, face: 0, kiosk: 0, manual: 0, sum: 0 };
  }

  // Scale to 1000 units to represent 1 decimal place (100.0%)
  const TARGET = 1000;
  const values = counts.map((c) => (c / total) * TARGET);
  const floors = values.map((v) => Math.floor(v));
  const remainders = values.map((v, i) => ({ index: i, rem: v - floors[i] }));

  const floorSum = floors.reduce((acc, f) => acc + f, 0);
  const deficit = TARGET - floorSum;

  // Distribute deficit to highest remainders
  remainders.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < deficit; i++) {
    floors[remainders[i].index]++;
  }

  const pcts = floors.map((f) => Math.round(f) / 10);
  const sum = Math.round(pcts.reduce((acc, p) => acc + p, 0) * 10) / 10;

  return {
    qr: pcts[0],
    face: pcts[1],
    kiosk: pcts[2],
    manual: pcts[3],
    sum,
  };
}
