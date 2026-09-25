import React from 'react';
import { useNavigate } from 'react-router-dom';
import { StatCard } from '../../../components/dashboard/StatCard';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { WidgetShell, formatNumber } from '../../../core/components/WidgetShell';
import { useAuth } from '../../../core/auth/AuthProvider';
import { useScopedAttendanceQuery } from '../../attendance/hooks';
import { useSessionsHistoricalQuery } from '../../sessions/hooks';
import type { WidgetProps } from '../../../core/types';

export const LiveSessionsCard: React.FC<WidgetProps> = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const scope = role === 'teacher' ? 'mine' : 'all';
  const attendanceQuery = useScopedAttendanceQuery(scope, { pollMs: 60000 });
  const sessionsQuery = useSessionsHistoricalQuery({ pollMs: 60000 });

  return (
    <WidgetShell
      query={attendanceQuery}
      skeleton={<SkeletonCard />}
      isEmpty={(data) => data === undefined || data === null}
    >
      {(data) => {
        const liveCount = data.activeSessions ?? 0;
        const sessions = sessionsQuery.data || [];
        const nextOrActiveSession = sessions.find((s) => s.status === 'OPEN') || sessions[0];

        let sublineText = 'No upcoming sessions scheduled';
        if (nextOrActiveSession) {
          if (nextOrActiveSession.status === 'OPEN') {
            sublineText = `Active: ${nextOrActiveSession.subject_name} (${nextOrActiveSession.section_name})`;
          } else {
            sublineText = `Next: ${nextOrActiveSession.subject_name} at ${nextOrActiveSession.period}`;
          }
        }

        const isLive = liveCount > 0;
        const indicator = (
          <span className="relative flex h-2 w-2 mr-1">
            {isLive ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </>
            ) : (
              <span className="inline-block h-2 w-2 rounded-full bg-slate-600" />
            )}
          </span>
        );

        return (
          <StatCard
            title="Live Sessions"
            value={formatNumber(liveCount)}
            indicator={indicator}
            subline={sublineText}
            footer="Auto-refreshes every 60s"
            onClick={() => navigate('/sessions/live')}
            menuItems={[
              {
                label: 'View details',
                onClick: () => navigate('/sessions/live'),
              },
              {
                label: 'Refresh',
                onClick: () => {
                  attendanceQuery.refetch();
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
