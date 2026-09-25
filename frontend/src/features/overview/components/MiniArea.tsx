import React from 'react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';

export interface MiniAreaItem {
  label?: string;
  hour?: string;
  value?: number;
  count?: number;
}

export interface MiniAreaProps {
  data: MiniAreaItem[] | number[];
  color?: string;
  height?: number;
}

export const MiniArea: React.FC<MiniAreaProps> = ({
  data,
  color = '#6366f1',
  height = 36,
}) => {
  const chartData = (data || []).map((d, index) =>
    typeof d === 'number'
      ? { index, value: d }
      : { index, label: d.label || d.hour, value: d.value ?? d.count ?? 0 }
  );

  const gradientId = React.useId().replace(/:/g, '_');

  return (
    <div style={{ width: '100%', height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
