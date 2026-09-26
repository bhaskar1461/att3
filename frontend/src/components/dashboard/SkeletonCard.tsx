import React from 'react';
import { Card, CardHeader, CardContent } from '../ui/card';

export interface SkeletonCardProps {
  lines?: number;
  height?: string | number;
  chart?: 'bars' | 'area' | 'donut' | 'none';
  className?: string;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  lines = 2,
  height,
  chart = 'none',
  className = '',
}) => {
  return (
    <Card
      className={`animate-pulse overflow-hidden bg-[#1e1f24] border border-[#2a2b31] rounded-[12px] p-5 flex flex-col justify-between ${className}`}
      style={height ? { minHeight: height } : undefined}
      aria-busy="true"
      aria-label="Loading content"
    >
      <div>
        <CardHeader className="p-0 pb-3 flex flex-row items-center justify-between">
          <div className="h-3.5 w-1/3 bg-[#2a2b31] rounded" />
          <div className="h-4 w-4 bg-[#2a2b31]/60 rounded" />
        </CardHeader>

        <div className="flex items-baseline gap-3 my-2">
          <div className="h-8 w-20 bg-[#2a2b31] rounded" />
          <div className="h-5 w-12 bg-[#2a2b31]/60 rounded-full" />
        </div>

        <CardContent className="p-0 space-y-2 mt-2">
          {Array.from({ length: lines }).map((_, index) => (
            <div
              key={index}
              className="h-2.5 bg-[#2a2b31]/70 rounded"
              style={{ width: `${Math.max(40, 90 - index * 20)}%` }}
            />
          ))}
        </CardContent>
      </div>

      {/* Optional Chart Skeletons */}
      {chart === 'bars' && (
        <div className="flex items-end gap-1.5 h-8 pt-2 mt-2 w-full">
          {[40, 65, 30, 80, 50, 90, 70].map((h, i) => (
            <div
              key={i}
              className="flex-1 bg-[#2a2b31]/60 rounded-t animate-pulse"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      )}

      {chart === 'area' && (
        <div className="h-8 w-full mt-2 rounded bg-gradient-to-t from-[#2a2b31]/80 to-[#2a2b31]/10 animate-pulse" />
      )}

      {chart === 'donut' && (
        <div className="w-12 h-12 rounded-full border-4 border-[#2a2b31] border-t-[#6366f1]/40 animate-pulse mx-auto mt-2" />
      )}
    </Card>
  );
};
