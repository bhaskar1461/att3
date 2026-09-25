import React from 'react';
import { useNavigate } from 'react-router-dom';
import { StatCard } from '../../../components/dashboard/StatCard';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { WidgetShell, formatPercentage } from '../../../core/components/WidgetShell';
import { useAuth } from '../../../core/auth/AuthProvider';
import { useScopedAttendanceQuery } from '../../attendance/hooks';
import { useSessionsHistoricalQuery } from '../../sessions/hooks';
import { MiniBars } from '../components/MiniBars';
import { selectDailyAttendanceRates } from '../selectors';
import type { WidgetProps } from '../../../core/types';

export const AttendanceRateCard: React.FC<WidgetProps> = ({ range = 'today' }) => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const scope = role === 'teacher' ? 'mine' : 'all';
  const query = useScopedAttendanceQuery(scope);
  const sessionsQuery = useSessionsHistoricalQuery();

  return (
    <WidgetShell
      query={query}
      skeleton={<SkeletonCard chart="bars" />}
      isEmpty={(data) => data === undefined || data === null}
    >
      {(data) => {
        const rate = data.rate ?? 0;
        const dailyRates = selectDailyAttendanceRates(sessionsQuery.data);
        const delta = 2.4;
        const rangeLabel = range === 'today' ? 'Today' : range === 'week' ? 'Last 7 Days' : 'This Month';

        return (
          <StatCard
            title="Attendance Rate"
            value={formatPercentage(rate)}
            delta={delta}
            chart={<MiniBars data={dailyRates} color="#6366f1" />}
            chartPlacement="below"
            footer={`Range: ${rangeLabel}`}
            onClick={() => navigate('/compliance')}
            menuItems={[
              {
                label: 'View details',
                onClick: () => navigate('/compliance'),
              },
              {
                label: 'Refresh',
                onClick: () => {
                  query.refetch();
                  sessionsQuery.refetch();
                },
              },
            ]}
          />
        );
      }}
    </WidgetShell>
  );
};
