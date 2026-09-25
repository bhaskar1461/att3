import React, { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../ui/card';
import { SkeletonCard } from './SkeletonCard';

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  loading?: boolean;
  className?: string;
}

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  toolbar,
  children,
  loading = false,
  className = '',
}) => {
  if (loading) {
    return <SkeletonCard className={`p-5 min-h-[320px] ${className}`} lines={4} />;
  }

  return (
    <Card className={`rounded-[12px] bg-[#1e1f24] border border-[#2a2b31] p-5 ${className}`}>
      {/* Header Row: Title (15px semibold) + toolbar slot + kebab */}
      <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between gap-3 border-b border-[#2a2b31]/40">
        <div>
          <h3 className="text-[15px] font-semibold text-white tracking-tight leading-none">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-[#9ca3af] mt-1">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {toolbar && <div className="flex items-center gap-1.5">{toolbar}</div>}
          <button
            type="button"
            aria-label={`Options for ${title}`}
            className="text-[#9ca3af] hover:text-white p-1 rounded-md hover:bg-[#2a2b31]/60 transition-colors shrink-0"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </CardHeader>

      {/* Body: children */}
      <CardContent className="p-0 pt-4">
        {children}
      </CardContent>
    </Card>
  );
};
