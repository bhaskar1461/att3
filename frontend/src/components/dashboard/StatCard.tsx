import React, { ReactNode } from 'react';
import { MoreHorizontal, ArrowRight } from 'lucide-react';
import { Card } from '../ui/card';
import { DeltaPill } from './DeltaPill';
import { SkeletonCard } from './SkeletonCard';

export interface StatCardMenuItem {
  label: string;
  onClick: () => void;
}

export interface StatCardProps {
  title: string;
  value: string | number;
  delta?: number;
  invertDelta?: boolean;
  footer?: string;
  chart?: ReactNode;
  chartPlacement?: 'right' | 'below';
  indicator?: ReactNode;
  subline?: ReactNode;
  onClick?: () => void;
  menuItems?: StatCardMenuItem[];
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
  indicator,
  subline,
  onClick,
  menuItems,
  loading = false,
  className = '',
}) => {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

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
      className={`p-5 rounded-[12px] bg-[#1e1f24] border border-[#2a2b31] transition-all relative group ${
        isInteractive
          ? 'cursor-pointer hover:border-[#6366f1]/40 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'
          : ''
      } ${className}`}
    >
      {/* Row 1: Title (13px muted) + Indicator + MoreHorizontal kebab */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 truncate">
          {indicator}
          <span className="text-[13px] font-medium text-[#9ca3af] tracking-normal truncate">
            {title}
          </span>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label={`Options for ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              if (menuItems && menuItems.length > 0) {
                setIsMenuOpen((prev) => !prev);
              }
            }}
            className="text-[#9ca3af] hover:text-white p-1 rounded-md hover:bg-[#2a2b31]/60 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {/* Kebab Dropdown Menu */}
          {menuItems && menuItems.length > 0 && isMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-7 z-50 min-w-[130px] rounded-lg bg-[#1e1f24] border border-[#2a2b31] py-1 shadow-2xl text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              {menuItems.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMenuOpen(false);
                    item.onClick();
                  }}
                  className="w-full text-left px-3 py-1.5 text-slate-300 hover:text-white hover:bg-[#2a2b31]/80 transition-colors flex items-center justify-between"
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Value (30px font-semibold tracking-tight) + DeltaPill inline + optional right chart */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[30px] font-semibold text-white tracking-tight leading-none tabular-nums">
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

      {/* Optional Subline */}
      {subline && (
        <div className="mt-2 text-xs text-[#9ca3af] truncate">
          {subline}
        </div>
      )}

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
