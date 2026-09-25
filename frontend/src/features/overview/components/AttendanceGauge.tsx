import React, { useState, useEffect } from 'react';

export interface AttendanceGaugeProps {
  value: number; // ratePct (0 - 100)
  total: number; // total check-ins
  sublabel?: string;
  range?: string;
  className?: string;
}

export const AttendanceGauge: React.FC<AttendanceGaugeProps> = ({
  value,
  total,
  sublabel,
  range,
  className = '',
}) => {
  const [reducedMotion, setReducedMotion] = useState(false);

  // Check prefers-reduced-motion
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const clampedValue = Math.min(100, Math.max(0, isNaN(value) ? 0 : value));
  const sweepLength = 61.1; // 220deg / 360deg * 100
  const targetDash = (clampedValue * 0.611).toFixed(2);

  // Animate stroke-dashoffset on mount and on range change
  const [offset, setOffset] = useState(() => (reducedMotion ? 0 : sweepLength));

  useEffect(() => {
    if (reducedMotion) {
      setOffset(0);
      return;
    }
    setOffset(sweepLength);
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setOffset(0);
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [value, range, reducedMotion]);

  const formattedRate = (Math.round(clampedValue * 10) / 10).toFixed(1);
  const formattedTotal = new Intl.NumberFormat().format(total);
  const displaySublabel = sublabel ?? `${formattedTotal} check-ins`;

  return (
    <div
      role="img"
      aria-label={`Overall attendance ${formattedRate} percent across ${formattedTotal} check-ins`}
      className={`relative flex items-center justify-center ${className}`}
    >
      <svg
        viewBox="0 0 140 140"
        className="w-44 h-44 drop-shadow-sm select-none"
        aria-hidden="true"
      >
        {/* Background track: 220deg sweep (61.1 100) rotated 110deg */}
        <circle
          cx={70}
          cy={70}
          r={54}
          pathLength={100}
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth={9}
          strokeDasharray="61.1 100"
          transform="rotate(110 70 70)"
        />

        {/* Value circle: ratePct * 0.611 out of 100 */}
        <circle
          cx={70}
          cy={70}
          r={54}
          pathLength={100}
          fill="none"
          stroke="#ffffff"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${targetDash} 100`}
          transform="rotate(110 70 70)"
          style={{
            strokeDashoffset: offset,
            transition: reducedMotion
              ? 'none'
              : 'stroke-dashoffset 600ms cubic-bezier(0, 0, 0.2, 1)',
          }}
        />
      </svg>

      {/* Center text: 32px semibold tabular-nums + 13px white/70 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        <span className="text-[32px] font-semibold text-white tabular-nums leading-none tracking-tight">
          {formattedRate}%
        </span>
        <span className="text-[13px] text-white/70 font-normal mt-1.5 truncate max-w-[120px]">
          {displaySublabel}
        </span>
      </div>
    </div>
  );
};
