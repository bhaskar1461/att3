import React, { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { ProgressBar } from './ProgressBar';
import { LegendSquare } from './LegendSquare';
import { SkeletonCard } from './SkeletonCard';

export interface GradientHeroCardProps {
  title?: string;
  gaugeValue: number;
  gaugeLabel: string;
  subStats: { label: string; value: string | number; color: string }[];
  segments: { label: string; value: number; color: string }[];
  menu?: ReactNode;
  loading?: boolean;
  className?: string;
}

export const GradientHeroCard: React.FC<GradientHeroCardProps> = ({
  title = 'Real-Time Attendance Rate',
  gaugeValue,
  gaugeLabel,
  subStats,
  segments,
  menu,
  loading = false,
  className = '',
}) => {
  if (loading) {
    return <SkeletonCard className={`p-6 min-h-[260px] ${className}`} lines={3} />;
  }

  // SVG Radial Gauge Calculation (Radius 44, Circumference ~276.46)
  const radius = 44;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const clampedValue = Math.min(100, Math.max(0, gaugeValue));
  const strokeDashoffset = circumference - (clampedValue / 100) * circumference;

  return (
    <div
      className={`relative overflow-hidden rounded-[12px] bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] p-6 text-white shadow-xl shadow-purple-500/15 border border-purple-400/30 flex flex-col justify-between ${className}`}
    >
      {/* Soft Radial Glow (Top-Right) */}
      <div
        className="absolute -top-10 -right-10 w-52 h-52 bg-white/15 rounded-full blur-2xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Header Row: Title & Kebab Menu in white/70 */}
      <div className="relative z-10 flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-bold tracking-tight text-white/95 uppercase">
          {title}
        </h3>

        <div className="flex items-center gap-1.5">
          {menu}
          <button
            type="button"
            aria-label="Hero options"
            className="text-white/70 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Center Layout: Radial Gauge + SubStats */}
      <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6 my-2">
        {/* Radial Gauge SVG */}
        <div className="relative flex items-center justify-center shrink-0">
          <svg className="w-28 h-28 transform -rotate-90" viewBox="0 0 100 100">
            {/* Background track */}
            <circle
              cx="50"
              cy="50"
              r={radius}
              stroke="rgba(255, 255, 255, 0.2)"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {/* Progress Arc */}
            <circle
              cx="50"
              cy="50"
              r={radius}
              stroke="#ffffff"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-700 ease-out"
            />
          </svg>

          {/* Center Value + Label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-extrabold tracking-tight text-white leading-none">
              {Math.round(clampedValue)}%
            </span>
            <span className="text-[10px] font-semibold text-white/80 uppercase tracking-wider mt-0.5 max-w-[70px] truncate">
              {gaugeLabel}
            </span>
          </div>
        </div>

        {/* SubStats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-1 gap-3 w-full sm:w-auto">
          {subStats.map((stat, i) => (
            <div key={i} className="flex items-center justify-between sm:justify-start gap-3 bg-black/15 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
              <LegendSquare color={stat.color} />
              <div className="flex flex-col text-left">
                <span className="text-[10px] text-white/70 font-medium">
                  {stat.label}
                </span>
                <span className="text-xs font-bold text-white tracking-tight">
                  {stat.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Segmented Progress Bar */}
      <div className="relative z-10 mt-4 space-y-1.5">
        <ProgressBar
          segments={segments.map((s) => ({ value: s.value, color: s.color, label: s.label }))}
          height={6}
          className="bg-black/20"
        />
        <div className="flex items-center justify-between text-[11px] text-white/75 font-medium">
          {segments.map((s, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
