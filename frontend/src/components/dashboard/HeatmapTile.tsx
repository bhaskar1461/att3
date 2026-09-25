import React from 'react';

export interface HeatmapTileProps {
  intensity: number; // 0..1
  count: number;
  label: string;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}

export const HeatmapTile: React.FC<HeatmapTileProps> = ({
  intensity,
  count,
  label,
  onClick,
  loading = false,
  className = '',
}) => {
  if (loading) {
    return (
      <div className={`w-[28px] h-[28px] rounded-md bg-[#2a2b31] animate-pulse ${className}`} />
    );
  }

  const clamped = Math.min(1, Math.max(0, intensity));
  const percent = Math.round(clamped * 100);
  const isInteractive = Boolean(onClick);

  return (
    <div
      title={`${label} — ${count} check-ins`}
      tabIndex={isInteractive ? 0 : undefined}
      role={isInteractive ? 'button' : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={{
        backgroundColor: `color-mix(in srgb, #6366f1 ${percent}%, #1e1f24)`,
      }}
      className={`w-[28px] h-[28px] rounded-md border border-[#2a2b31]/80 transition-all ${
        isInteractive
          ? 'cursor-pointer hover:scale-110 hover:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'
          : ''
      } ${className}`}
      aria-label={`${label}: ${count} check-ins`}
    />
  );
};
