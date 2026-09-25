import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import type { TrendBucket } from '../selectors';
import { LegendSquare } from '../../../components/dashboard/LegendSquare';

export interface TrendChartProps {
  data: TrendBucket[];
  loading?: boolean;
  range?: 'today' | 'week' | 'month';
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;

  const present = payload.find((p) => p.name === 'present')?.value ?? 0;
  const late = payload.find((p) => p.name === 'late')?.value ?? 0;
  const absent = payload.find((p) => p.name === 'absent')?.value ?? 0;
  const total = present + late + absent;

  return (
    <div className="rounded-lg bg-[#1e1f24] border border-[#2a2b31] p-2.5 shadow-2xl text-xs space-y-1.5 min-w-[130px] z-50">
      <div className="font-medium text-white/90 pb-1 border-b border-[#2a2b31]">
        {label}
      </div>
      <div className="flex items-center justify-between text-[#9ca3af]">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-[#34d399]" />
          Present
        </span>
        <span className="font-semibold text-white">{present}</span>
      </div>
      <div className="flex items-center justify-between text-[#9ca3af]">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-[#fbbf24]" />
          Late
        </span>
        <span className="font-semibold text-white">{late}</span>
      </div>
      <div className="flex items-center justify-between text-[#9ca3af]">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-[#f87171]" />
          Absent
        </span>
        <span className="font-semibold text-white">{absent}</span>
      </div>
      <div className="pt-1 border-t border-[#2a2b31] flex items-center justify-between text-white font-medium">
        <span>Total</span>
        <span>{total}</span>
      </div>
    </div>
  );
};

export const TrendChart: React.FC<TrendChartProps> = ({
  data,
  loading = false,
  range = 'today',
}) => {
  const totals = useMemo(() => {
    let p = 0;
    let l = 0;
    let a = 0;
    for (const b of data) {
      p += b.present;
      l += b.late;
      a += b.absent;
    }
    return { present: p, late: l, absent: a, total: p + l + a };
  }, [data]);

  const ariaLabel = `Attendance trend for ${range}: ${data.length} buckets, total ${totals.present} present, ${totals.late} late, and ${totals.absent} absent.`;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="relative w-full h-[260px] flex flex-col justify-between select-none"
    >
      {/* Chart Area */}
      <div className="w-full h-[225px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            barCategoryGap={range === 'month' ? '15%' : '28%'}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(255, 255, 255, 0.05)"
            />
            <XAxis
              dataKey="label"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval={range === 'month' ? 4 : 0}
            />
            <YAxis
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickCount={4}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
            />
            <Bar
              dataKey="present"
              stackId="a"
              fill="#34d399"
              radius={[0, 0, 0, 0]}
              name="present"
            />
            <Bar
              dataKey="late"
              stackId="a"
              fill="#fbbf24"
              radius={[0, 0, 0, 0]}
              name="late"
            />
            <Bar
              dataKey="absent"
              stackId="a"
              fill="#f87171"
              radius={[3, 3, 0, 0]}
              name="absent"
            />
          </BarChart>
        </ResponsiveContainer>

        {/* Refetching / Loading skeleton overlay */}
        {loading && (
          <div className="absolute inset-0 bg-[#1e1f24]/60 backdrop-blur-[2px] flex items-center justify-center rounded-lg transition-opacity">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Legend Row */}
      <div className="flex items-center justify-center gap-6 pt-2 border-t border-[#2a2b31]/40 text-xs text-[#9ca3af]">
        <div className="flex items-center gap-2">
          <LegendSquare color="#34d399" label="Present" />
          <span className="text-white font-medium">{totals.present}</span>
        </div>
        <div className="flex items-center gap-2">
          <LegendSquare color="#fbbf24" label="Late" />
          <span className="text-white font-medium">{totals.late}</span>
        </div>
        <div className="flex items-center gap-2">
          <LegendSquare color="#f87171" label="Absent" />
          <span className="text-white font-medium">{totals.absent}</span>
        </div>
      </div>
    </div>
  );
};
