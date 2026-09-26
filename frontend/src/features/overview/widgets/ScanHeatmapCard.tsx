import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WidgetProps } from '../../../core/types';
import { WidgetShell } from '../../../core/components/WidgetShell';
import { ChartCard } from '../../../components/dashboard/ChartCard';
import { HeatmapGrid } from '../components/HeatmapGrid';
import { useRecords } from '../../attendance/hooks';
import { useAuth } from '../../auth/hooks';
import { weekHourMatrix, HeatmapCell } from '../selectors';
import type { AttendanceRecord } from '../../../core/api/schemas/attendance';

export const ScanHeatmapCard: React.FC<WidgetProps> = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const scope: 'mine' | 'all' = user?.role === 'teacher' ? 'mine' : 'all';

  const query = useRecords({
    range: 'week',
    scope,
  });

  const { data: records } = query;

  const heatmapData = useMemo(() => weekHourMatrix(records), [records]);

  const handleTileClick = (cell: HeatmapCell) => {
    navigate(`/attendance/day?date=${cell.dateString}&hour=${cell.hourBand}`);
  };

  // Toolbar legend: Less [5 tiles intensity 0..1] More
  const legendToolbar = (
    <div className="flex items-center gap-1.5 select-none" aria-label="Heatmap intensity legend">
      <span className="text-[11px] text-[#9ca3af]">Less</span>
      <div className="flex items-center gap-1">
        {[0, 0.25, 0.5, 0.75, 1.0].map((step, idx) => (
          <div
            key={idx}
            className="w-3 h-3 rounded-xs border border-[#2a2b31]/80 dark:border-[#2a2b31]/80 border-slate-200"
            style={{
              backgroundColor: `color-mix(in srgb, #6366f1 ${Math.round(step * 100)}%, var(--heatmap-tile-base, #1e1f24))`,
            }}
          />
        ))}
      </div>
      <span className="text-[11px] text-[#9ca3af]">More</span>
    </div>
  );

  return (
    <WidgetShell<AttendanceRecord[]>
      query={query}
      skeleton={
        <ChartCard
          title="Scan Time Heatmap"
          subtitle="This week"
          toolbar={legendToolbar}
          className="min-h-[300px]"
        >
          <HeatmapGrid loading={true} />
        </ChartCard>
      }
    >
      {() => (
        <ChartCard
          title="Scan Time Heatmap"
          subtitle="This week"
          toolbar={legendToolbar}
          className="min-h-[300px]"
        >
          <div className="pt-2">
            <HeatmapGrid
              matrix={heatmapData.matrix}
              totalScans={heatmapData.totalScans}
              onTileClick={handleTileClick}
            />
          </div>
        </ChartCard>
      )}
    </WidgetShell>
  );
};
