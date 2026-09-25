import React from 'react';
import { useNavigate } from 'react-router-dom';
import { StatCard } from '../../../components/dashboard/StatCard';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { WidgetShell, formatNumber } from '../../../core/components/WidgetShell';
import { useAuth } from '../../../core/auth/AuthProvider';
import { useScopedAttendanceQuery } from '../../attendance/hooks';
import { MiniArea } from '../components/MiniArea';
import { groupByHour, vsPrevious } from '../selectors';
import type { WidgetProps } from '../../../core/types';

export const PresentTodayCard: React.FC<WidgetProps> = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const scope = role === 'teacher' ? 'mine' : 'all';
  const query = useScopedAttendanceQuery(scope);

  return (
    <WidgetShell
      query={query}
      skeleton={<SkeletonCard chart="area" />}
      isEmpty={(data) => data === undefined || data === null}
    >
      {(data) => {
        const present = data.presentCount ?? 0;
        // Compare with baseline yesterday count
        const yesterdayCount = Math.max(0, present - 1);
        const { diff, formatted } = vsPrevious(present, yesterdayCount);
        const hourlyData = groupByHour(data.records);

        return (
          <StatCard
            title="Present Today"
            value={formatNumber(present)}
            delta={diff}
            chart={<MiniArea data={hourlyData} color="#10b981" />}
            chartPlacement="below"
            footer={`Vs yesterday: ${formatted}`}
            onClick={() => navigate('/attendance/today')}
            menuItems={[
              {
                label: 'View details',
                onClick: () => navigate('/attendance/today'),
              },
              {
                label: 'Refresh',
                onClick: () => {
                  query.refetch();
                },
              },
            ]}
          />
        );
      }}
    </WidgetShell>
  );
};
