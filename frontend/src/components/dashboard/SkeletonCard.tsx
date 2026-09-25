import React from 'react';
import { Card, CardHeader, CardContent } from '../ui/card';

export interface SkeletonCardProps {
  lines?: number;
  height?: string | number;
  className?: string;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  lines = 3,
  height,
  className = '',
}) => {
  return (
    <Card
      className={`animate-pulse overflow-hidden bg-[#1e1f24] border border-[#2a2b31] rounded-[12px] p-5 ${className}`}
      style={height ? { minHeight: height } : undefined}
      aria-busy="true"
      aria-label="Loading content"
    >
      <CardHeader className="p-0 pb-4 space-y-2">
        <div className="h-4 w-1/3 bg-[#2a2b31] rounded" />
        <div className="h-3 w-1/2 bg-[#2a2b31]/60 rounded" />
      </CardHeader>
      <CardContent className="p-0 space-y-3">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className="h-3 bg-[#2a2b31]/70 rounded"
            style={{ width: `${Math.max(40, 100 - index * 18)}%` }}
          />
        ))}
      </CardContent>
    </Card>
  );
};
