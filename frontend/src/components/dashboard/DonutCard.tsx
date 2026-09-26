import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../ui/card';
import { LegendSquare } from './LegendSquare';
import { ProgressBar } from './ProgressBar';
import { SkeletonCard } from './SkeletonCard';

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutCardProps {
  title: string;
  centerValue: number | string;
  centerLabel?: string;
  segments: DonutSegment[];
  selectedId?: string;
  onSegmentClick?: (id: string) => void;
  progress?: { done: number; total: number; label: string };
  progressTop?: { done: number; total: number; label: string };
  loading?: boolean;
  className?: string;
}

export const DonutCard: React.FC<DonutCardProps> = ({
  title,
  centerValue,
  centerLabel = 'Total',
  segments,
  selectedId,
  onSegmentClick,
  progress,
  progressTop,
  loading = false,
  className = '',
}) => {
  if (loading) {
    return <SkeletonCard chart="donut" className={`p-5 min-h-[340px] ${className}`} lines={4} />;
  }

  const isClickable = Boolean(onSegmentClick);
  const isAllZero = segments.every((s) => s.value === 0);
  const displaySegments = isAllZero
    ? [{ id: 'empty', label: 'All queues clear', value: 1, color: '#2a2b31' }]
    : segments;
  const displayCenterLabel = isAllZero ? 'All queues clear' : centerLabel;

  const activeIndex =
    !isAllZero && selectedId
      ? displaySegments.findIndex((s) => s.id === selectedId)
      : undefined;

  return (
    <Card className={`rounded-[12px] bg-[#1e1f24] border border-[#2a2b31] p-5 flex flex-col justify-between ${className}`}>
      {/* Header */}
      <CardHeader className="p-0 pb-3 border-b border-[#2a2b31]/40 flex flex-row items-center justify-between">
        <h2 className="text-[15px] font-semibold text-white tracking-tight">
          {title}
        </h2>
        {progress && (
          <span className="text-xs font-mono text-[#9ca3af]">
            {progress.done}/{progress.total}
          </span>
        )}
      </CardHeader>

      <CardContent className="p-0 pt-4 space-y-4">
        {/* Progress bar on top: "Resolved today {n}" */}
        {progressTop && (
          <div className="pb-3 border-b border-[#2a2b31]/40 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
              <span>{progressTop.label}</span>
              <span className="font-mono text-white font-semibold tabular-nums">
                {progressTop.done}
              </span>
            </div>
            <ProgressBar
              segments={[{ value: progressTop.done, color: '#10b981' }]}
              height={5}
            />
          </div>
        )}

        {/* Recharts Pie Chart with Absolute-Centered Count */}
        <div
          role="img"
          aria-label={`${title}: ${centerValue} total items. ${segments.map((s) => `${s.label}: ${s.value}`).join(', ')}.`}
          className="relative w-full h-44 flex items-center justify-center"
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={displaySegments}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius="62%"
                outerRadius="85%"
                paddingAngle={isAllZero ? 0 : 2}
                cornerRadius={4}
                stroke="#1e1f24"
                strokeWidth={2}
                onClick={(_, index) => {
                  if (isAllZero) return;
                  const clicked = segments[index];
                  if (clicked && onSegmentClick) {
                    onSegmentClick(clicked.id);
                  }
                }}
              >
                {displaySegments.map((entry) => {
                  const isSelected = entry.id === selectedId;
                  return (
                    <Cell
                      key={`cell-${entry.id}`}
                      fill={entry.color}
                      stroke={isSelected ? '#ffffff' : '#1e1f24'}
                      strokeWidth={isSelected ? 3 : 2}
                      className={!isAllZero && isClickable ? 'cursor-pointer hover:opacity-80 transition-all' : ''}
                    />
                  );
                })}
              </Pie>

              {/* Selected Pie segment: outerRadius +4 highlight overlay */}
              {selectedId && !isAllZero && (
                <Pie
                  data={displaySegments}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius="62%"
                  outerRadius="89%"
                  paddingAngle={2}
                  cornerRadius={4}
                  stroke="transparent"
                  isAnimationActive={false}
                >
                  {displaySegments.map((entry) => {
                    const isSelected = entry.id === selectedId;
                    return (
                      <Cell
                        key={`highlight-${entry.id}`}
                        fill={isSelected ? entry.color : 'transparent'}
                        stroke={isSelected ? '#ffffff' : 'transparent'}
                        strokeWidth={isSelected ? 2 : 0}
                      />
                    );
                  })}
                </Pie>
              )}
            </PieChart>
          </ResponsiveContainer>

          {/* Absolute-Centered Count and Label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <span className="text-2xl font-bold tracking-tight text-white leading-none tabular-nums">
              {centerValue}
            </span>
            {displayCenterLabel && (
              <span className="text-[11px] font-medium text-[#9ca3af] uppercase tracking-wider mt-1">
                {displayCenterLabel}
              </span>
            )}
          </div>
        </div>

        {/* Legend Rows */}
        <div className="space-y-1">
          {segments.map((seg) => {
            const isSelected = seg.id === selectedId;
            return (
              <div
                key={seg.id}
                tabIndex={isClickable ? 0 : undefined}
                role={isClickable ? 'button' : undefined}
                onClick={() => onSegmentClick?.(seg.id)}
                onKeyDown={
                  isClickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSegmentClick?.(seg.id);
                        }
                      }
                    : undefined
                }
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors group ${
                  isSelected
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'hover:bg-white/5'
                } ${isClickable ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <LegendSquare color={seg.color} />
                  <span className={`text-xs truncate ${isSelected ? 'text-white font-medium' : 'text-slate-200 group-hover:text-white'}`}>
                    {seg.label}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs font-semibold text-white font-mono tabular-nums">
                    {seg.value}
                  </span>
                  {isClickable && (
                    <ChevronRight
                      className={`w-3.5 h-3.5 transition-all ${
                        isSelected
                          ? 'opacity-100 text-indigo-400'
                          : 'opacity-0 group-hover:opacity-100 text-[#9ca3af]'
                      }`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Optional Progress Footer */}
        {progress && (
          <div className="pt-2 border-t border-[#2a2b31]/40 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
              <span>{progress.label}</span>
              <span className="font-mono text-white tabular-nums">
                {Math.round((progress.done / (progress.total || 1)) * 100)}%
              </span>
            </div>
            <ProgressBar
              segments={[{ value: progress.done, color: '#6366f1' }]}
              height={5}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
