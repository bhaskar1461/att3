import React from 'react';
import { ChartCard } from '../../../components/dashboard/ChartCard';
import { WidgetShell } from '../../../core/components/WidgetShell';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { useSessionsHistoricalQuery } from '../../sessions/hooks';
import { RegistersTable } from '../components/RegistersTable';
import type { WidgetProps } from '../../../core/types';

export const RecentRegistersCard: React.FC<WidgetProps> = () => {
  const query = useSessionsHistoricalQuery();

  return (
    <WidgetShell
      query={query}
      skeleton={<SkeletonCard chart="area" className="h-[380px]" />}
      isEmpty={(data) => !data || data.length === 0}
      empty={
        <div className="py-12 text-center text-slate-400 text-xs">
          No registers yet — they appear after the first session.
        </div>
      }
    >
      {(sessions) => (
        <ChartCard
          title="Recent Registers"
          subtitle="Recent classroom attendance records & export dispatch"
        >
          <RegistersTable sessions={sessions} />
        </ChartCard>
      )}
    </WidgetShell>
  );
};
