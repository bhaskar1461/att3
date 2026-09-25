import React from 'react';
import { ProgressBar } from '../../../components/dashboard/ProgressBar';
import { LegendSquare } from '../../../components/dashboard/LegendSquare';

export interface StatusBreakdownProps {
  present: number;
  late: number;
  absent: number;
  total: number;
  className?: string;
}

export const StatusBreakdown: React.FC<StatusBreakdownProps> = ({
  present,
  late,
  absent,
  total,
  className = '',
}) => {
  if (total === 0) {
    return (
      <div className={`mt-5 pt-4 border-t border-white/10 ${className}`}>
        <span className="block text-[13px] text-white/70 font-medium mb-3">
          Check-in Status
        </span>
        <div className="py-6 px-4 text-center rounded-lg bg-white/10 border border-white/10 text-white/80 text-xs font-medium backdrop-blur-sm">
          No check-ins in this range
        </div>
      </div>
    );
  }

  const presentShare = (present / total) * 100;
  const lateShare = (late / total) * 100;
  const absentShare = (absent / total) * 100;

  const presentPctStr = presentShare.toFixed(1);
  const latePctStr = lateShare.toFixed(1);
  const absentPctStr = absentShare.toFixed(1);

  const segments = [
    { value: present, color: '#ffffff', label: 'Present' },
    { value: late, color: 'rgba(255, 255, 255, 0.6)', label: 'Late' },
    { value: absent, color: 'rgba(255, 255, 255, 0.3)', label: 'Absent' },
  ];

  return (
    <div className={`mt-5 pt-4 border-t border-white/10 ${className}`}>
      {/* Label 13px white/70 */}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[13px] text-white/70 font-medium">
          Check-in Status
        </span>
      </div>

      {/* Accessible sr-only summary sentence */}
      <p className="sr-only">
        {present} present, {late} late, and {absent} absent check-ins out of {total} total check-ins.
      </p>

      {/* Segmented ProgressBar aria-hidden */}
      <div aria-hidden="true" className="mb-3.5">
        <ProgressBar
          segments={segments}
          height={6}
          className="bg-black/25"
        />
      </div>

      {/* Legend rows beneath spaced 8px (space-y-2) */}
      <div className="space-y-2">
        {/* Present Row */}
        <div className="flex items-center justify-between text-[13px]">
          <div className="flex items-center gap-2">
            <LegendSquare color="#ffffff" className="w-2.5 h-2.5" />
            <span className="text-white/90 font-medium">Present</span>
          </div>
          <span className="font-semibold text-white tabular-nums">
            {presentPctStr}%
          </span>
        </div>

        {/* Late Row */}
        <div className="flex items-center justify-between text-[13px]">
          <div className="flex items-center gap-2">
            <LegendSquare color="rgba(255, 255, 255, 0.6)" className="w-2.5 h-2.5" />
            <span className="text-white/90 font-medium">Late</span>
          </div>
          <span className="font-semibold text-white tabular-nums">
            {latePctStr}%
          </span>
        </div>

        {/* Absent Row */}
        <div className="flex items-center justify-between text-[13px]">
          <div className="flex items-center gap-2">
            <LegendSquare color="rgba(255, 255, 255, 0.3)" className="w-2.5 h-2.5" />
            <span className="text-white/90 font-medium">Absent</span>
          </div>
          <span className="font-semibold text-white tabular-nums">
            {absentPctStr}%
          </span>
        </div>
      </div>
    </div>
  );
};
