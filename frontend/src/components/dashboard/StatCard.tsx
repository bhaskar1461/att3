import React, { ReactNode } from 'react';
import { MoreHorizontal, ArrowRight } from 'lucide-react';
import { Card } from '../ui/card';
import { DeltaPill } from './DeltaPill';
import { SkeletonCard } from './SkeletonCard';

export interface StatCardProps {
  title: string;
  value: string | number;
  delta?: number;
  invertDelta?: boolean;
  footer?: string;
  chart?: ReactNode;
  chartPlacement?: 'right' | 'below';
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  delta,
  invertDelta = false,
  footer,
  chart,
  chartPlacement = 'below',
  onClick,
  loading = false,
  className = '',
}) => {
  if (loading) {
    return <SkeletonCard className={`p-5 ${className}`} lines={2} />;
  }

  const isInteractive = Boolean(onClick);

  return (
    <Card
      onClick={onClick}
      tabIndex={isInteractive ? 0 : undefined}
      role={isInteractive ? 'button' : undefined}
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
      className={`p-5 rounded-[12px] bg-[#1e1f24] border border-[#2a2b31] transition-all group ${
        isInteractive
          ? 'cursor-pointer hover:border-[#6366f1]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'
          : ''
      } ${className}`}
    >
      {/* Row 1: Title (13px muted) + MoreHorizontal kebab */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[13px] font-medium text-[#9ca3af] tracking-normal truncate">
          {title}
        </span>
        <button
          type="button"
          aria-label={`Options for ${title}`}
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="text-[#9ca3af] hover:text-white p-1 rounded-md hover:bg-[#2a2b31]/60 transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Row 2: Value (30px font-semibold tracking-tight) + DeltaPill inline + optional right chart */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[30px] font-semibold text-white tracking-tight leading-none">
            {value}
          </span>
          {delta !== undefined && (
            <DeltaPill value={delta} invert={invertDelta} />
          )}
        </div>

        {chart && chartPlacement === 'right' && (
          <div className="shrink-0">{chart}</div>
        )}
      </div>

      {/* Optional Chart Below */}
      {chart && chartPlacement === 'below' && (
        <div className="mt-3 w-full overflow-hidden">{chart}</div>
      )}

      {/* Footer Row: 'Vs last month: X' muted + ArrowRight on hover when onClick set */}
      {footer && (
        <div className="mt-3.5 pt-2.5 border-t border-[#2a2b31]/60 flex items-center justify-between text-xs text-[#9ca3af]">
          <span className="truncate">{footer}</span>
          {isInteractive && (
            <ArrowRight className="w-3.5 h-3.5 text-indigo-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all shrink-0 ml-1" />
          )}
        </div>
      )}
    </Card>
  );
};
