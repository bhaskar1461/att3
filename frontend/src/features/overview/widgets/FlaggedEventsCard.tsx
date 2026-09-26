import React from 'react';
import { ChartCard } from '../../../components/dashboard/ChartCard';
import { WidgetShell } from '../../../core/components/WidgetShell';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { useAlerts } from '../../security/hooks';
import { EventsTable } from '../components/EventsTable';
import type { WidgetProps } from '../../../core/types';

export const FlaggedEventsCard: React.FC<WidgetProps> = () => {
  // Shared query with Donut and Topbar Bell
  const query = useAlerts({
    status: 'open',
    pollMs: 60_000,
  });

  return (
    <WidgetShell
      query={query}
      skeleton={<SkeletonCard chart="area" className="h-[380px]" />}
      isEmpty={(data) => !data || data.length === 0}
      empty={
        <div className="py-12 text-center text-slate-400 text-xs">
          No flagged security events recorded.
        </div>
      }
    >
      {(alerts) => (
        <ChartCard
          title="Flagged Events"
          subtitle="Real-time security telemetry and anomaly flags"
        >
          <EventsTable alerts={alerts} />
        </ChartCard>
      )}
    </WidgetShell>
  );
};
