import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface DeltaPillProps {
  value: number;
  invert?: boolean;
  className?: string;
  loading?: boolean;
}

export const DeltaPill: React.FC<DeltaPillProps> = ({
  value,
  invert = false,
  className = '',
  loading = false,
}) => {
  if (loading) {
    return <div className={`h-5 w-14 bg-[#2a2b31] rounded-md animate-pulse ${className}`} />;
  }

  // Determine whether positive is good or bad (flipped if invert is true)
  const isPositive = value > 0;
  const isZero = value === 0;
  const isGood = invert ? !isPositive : isPositive;

  const colorClasses = isZero
    ? 'border border-[#2a2b31] bg-[#2a2b31]/40 text-[#9ca3af]'
    : isGood
    ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
    : 'border border-red-500/20 bg-red-500/10 text-red-400';

  const sign = value > 0 ? '+' : '';
  const formatted = `${sign}${value.toFixed(1)}%`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold font-mono tracking-tight select-none ${colorClasses} ${className}`}
      aria-label={`change ${value} percent`}
    >
      {isZero ? (
        <Minus className="w-3 h-3 text-[#9ca3af]" />
      ) : isPositive ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
      <span>{formatted}</span>
    </span>
  );
};
