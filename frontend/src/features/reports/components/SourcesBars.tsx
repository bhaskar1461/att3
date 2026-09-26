import React from 'react';
import type { MethodSplitResult } from '../../overview/selectors';

export interface SourcesBarsProps {
  methodCounts: MethodSplitResult | undefined | null;
  className?: string;
}

// 5-step indigo shade ladder
const SHADE_LADDER = ['#4f46e5', '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd'];

export const SourcesBars: React.FC<SourcesBarsProps> = ({ methodCounts, className = '' }) => {
  const qr = methodCounts?.qr || 0;
  const face = methodCounts?.face || 0;
  const kiosk = methodCounts?.kiosk || 0;
  const manual = methodCounts?.manual || 0;

  // 5 bar counts: QR, Face, Kiosk, Manual, baseline/other
  const rawValues = [qr, face, kiosk, manual, 0];
  const max = Math.max(...rawValues, 0);

  // Normalized heights with min height for visual crispness
  const barHeights = rawValues.map((val) => {
    if (max === 0) return 15;
    const pct = Math.round((val / max) * 100);
    return Math.max(12, pct);
  });

  return (
    <div
      role="img"
      aria-label={`Check-in method volume bars: QR ${qr}, Face ${face}, Kiosk ${kiosk}, Manual ${manual}.`}
      className={`h-16 flex items-end justify-center gap-2.5 py-1 ${className}`}
    >
      {barHeights.map((height, idx) => (
        <div
          key={idx}
          className="w-5 rounded-t-sm transition-all duration-500 ease-out"
          style={{
            height: `${height}%`,
            backgroundColor: SHADE_LADDER[idx],
          }}
        />
      ))}
    </div>
  );
};
