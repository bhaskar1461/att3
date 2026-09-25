import React from 'react';

export interface ProgressSegment {
  value: number;
  color: string;
  label?: string;
}

export interface ProgressBarProps {
  segments: ProgressSegment[];
  height?: number;
  className?: string;
  loading?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  segments,
  height = 8,
  className = '',
  loading = false,
}) => {
  if (loading) {
    return (
      <div
        className={`w-full bg-[#2a2b31] rounded-full animate-pulse ${className}`}
        style={{ height }}
      />
    );
  }

  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total || 100}
      aria-valuenow={total}
      className={`w-full bg-[#2a2b31]/80 rounded-full overflow-hidden flex transition-all ${className}`}
      style={{ height }}
    >
      {segments.map((seg, idx) => {
        if (seg.value <= 0 || total === 0) return null;
        const pct = (seg.value / total) * 100;

        return (
          <div
            key={idx}
            title={seg.label ? `${seg.label}: ${seg.value} (${pct.toFixed(1)}%)` : `${pct.toFixed(1)}%`}
            className="h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${pct}%`,
              backgroundColor: seg.color,
            }}
          />
        );
      })}
    </div>
  );
};
