import React from 'react';
import { ResponsiveContainer, BarChart, Bar } from 'recharts';

export interface MiniBarItem {
  label?: string;
  value: number;
}

export interface MiniBarsProps {
  data: MiniBarItem[] | number[];
  color?: string;
  height?: number;
}

export const MiniBars: React.FC<MiniBarsProps> = ({
  data,
  color = '#6366f1',
  height = 36,
}) => {
  const chartData = (data || []).map((d, index) =>
    typeof d === 'number' ? { index, value: d } : { index, ...d }
  );

  return (
    <div style={{ width: '100%', height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
