import React from 'react';
import { useNavigate } from 'react-router-dom';
import { StatCard } from '../../../components/dashboard/StatCard';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { WidgetShell, formatNumber } from '../../../core/components/WidgetShell';
import { useRosterStudentsQuery } from '../../roster/hooks';
import { MiniBars } from '../components/MiniBars';
import {
  selectEnrollmentDelta,
  selectEnrollmentMonthlyTrend,
} from '../selectors';
import type { WidgetProps } from '../../../core/types';

export const TotalStudentsCard: React.FC<WidgetProps> = () => {
  const navigate = useNavigate();
  const query = useRosterStudentsQuery({ page: 1, page_size: 1 });

  return (
    <WidgetShell
      query={query}
      skeleton={<SkeletonCard chart="bars" />}
      isEmpty={(data) => {
        const count = Array.isArray(data) ? data.length : data?.total;
        return count === undefined || count === null;
      }}
    >
      {(data) => {
        const totalCount = Array.isArray(data) ? data.length : (data.total ?? 0);
        const delta = selectEnrollmentDelta();
        const trendData = selectEnrollmentMonthlyTrend();

        return (
          <StatCard
            title="Total Students"
            value={formatNumber(totalCount)}
            delta={delta}
            chart={<MiniBars data={trendData} />}
            chartPlacement="below"
            footer={`Vs last month: +${delta}`}
            onClick={() => navigate('/roster/students')}
            menuItems={[
              {
                label: 'View details',
                onClick: () => navigate('/roster/students'),
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
