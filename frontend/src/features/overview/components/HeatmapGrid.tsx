import React from 'react';
import { HeatmapTile } from '../../../components/dashboard/HeatmapTile';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../components/ui/tooltip';
import {
  HeatmapCell,
  HEATMAP_DAY_LABELS,
  HEATMAP_HOUR_LABELS,
} from '../selectors';

export interface HeatmapGridProps {
  matrix?: HeatmapCell[][];
  totalScans?: number;
  loading?: boolean;
  onTileClick?: (cell: HeatmapCell) => void;
  className?: string;
}

export const HeatmapGrid: React.FC<HeatmapGridProps> = ({
  matrix,
  totalScans = 0,
  loading = false,
  onTileClick,
  className = '',
}) => {
  // Loading state: 42 skeleton tiles
  if (loading || !matrix) {
    return (
      <div className={`space-y-2 select-none ${className}`}>
        {/* Header Days Row */}
        <div className="flex items-center gap-2">
          <div className="w-10 shrink-0" />
          <div className="grid grid-cols-7 gap-2 flex-1 max-w-[340px]">
            {HEATMAP_DAY_LABELS.map((d) => (
              <span
                key={d}
                className="text-[11px] font-medium text-[#9ca3af] text-center"
              >
                {d}
              </span>
            ))}
          </div>
        </div>

        {/* 6 Skeleton Rows */}
        {HEATMAP_HOUR_LABELS.map((h, rowIdx) => (
          <div key={rowIdx} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-[11px] font-medium text-[#9ca3af] text-right pr-1">
              {h}
            </span>
            <div className="grid grid-cols-7 gap-2 flex-1 max-w-[340px]">
              {HEATMAP_DAY_LABELS.map((_, colIdx) => (
                <HeatmapTile
                  key={colIdx}
                  loading={true}
                  intensity={0}
                  count={0}
                  label=""
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const isAllZero = totalScans === 0;

  return (
    <div
      role="img"
      aria-label={`Attendance scan intensity heatmap: ${totalScans} total scans across 7 days and 6 hour intervals.`}
      className={`relative space-y-2 select-none ${className}`}
    >
      {/* Screen reader accessible table representation */}
      <table className="sr-only">
        <caption>Weekly attendance check-in scan distribution by hour and day</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            {HEATMAP_DAY_LABELS.map((day) => (
              <th key={day} scope="col">{day}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, rowIdx) => (
            <tr key={rowIdx}>
              <th scope="row">{HEATMAP_HOUR_LABELS[rowIdx]}</th>
              {row.map((cell, colIdx) => (
                <td key={colIdx}>{cell.count} scans</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Header Days Row: Mon..Sun */}
      <div className="flex items-center gap-2">
        <div className="w-10 shrink-0" />
        <div className="grid grid-cols-7 gap-2 flex-1 max-w-[340px]">
          {HEATMAP_DAY_LABELS.map((day) => (
            <span
              key={day}
              className="text-[11px] font-medium text-[#9ca3af] text-center"
            >
              {day}
            </span>
          ))}
        </div>
      </div>

      {/* Grid of 6 rows (8am, 10am, 12pm, 2pm, 4pm, 6pm) */}
      <div className={`space-y-2 ${isAllZero ? 'opacity-30' : ''}`}>
        {matrix.map((row, rowIdx) => {
          const hourLabel = HEATMAP_HOUR_LABELS[rowIdx] || '';
          return (
            <div key={rowIdx} className="flex items-center gap-2">
              {/* Row Label (left) */}
              <span className="w-10 shrink-0 text-[11px] font-medium text-[#9ca3af] text-right pr-1">
                {hourLabel}
              </span>

              {/* 7 Day Tiles in Row-Major order */}
              <div className="grid grid-cols-7 gap-2 flex-1 max-w-[340px]">
                {row.map((cell) => {
                  return (
                    <Tooltip
                      key={`${cell.hourIndex}-${cell.dayIndex}`}
                      position="top"
                    >
                      <TooltipTrigger
                        tabIndex={0}
                        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onTileClick?.(cell);
                          }
                        }}
                      >
                        <HeatmapTile
                          intensity={cell.intensity}
                          count={cell.count}
                          label={cell.label}
                          suppressTitle={true}
                          onClick={() => {
                            onTileClick?.(cell);
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {cell.label} — {cell.count} check-ins
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-zero overlay centered message */}
      {isAllZero && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="px-3.5 py-1.5 rounded-full bg-[#1e1f24]/90 border border-[#2a2b31] shadow-lg backdrop-blur-sm">
            <span className="text-xs font-medium text-[#9ca3af]">
              No scans this week
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
