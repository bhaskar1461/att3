import React, { useState, useMemo } from 'react';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import { WidgetProps, Role } from '../../../core/types';
import { WidgetShell } from '../../../core/components/WidgetShell';
import { ChartCard } from '../../../components/dashboard/ChartCard';
import { LegendSquare } from '../../../components/dashboard/LegendSquare';
import { SkeletonCard } from '../../../components/dashboard/SkeletonCard';
import { useRecords } from '../../attendance/hooks';
import { useAuth } from '../../auth/hooks';
import { can } from '../../../core/roles';
import { normalizeRole } from '../../../core/auth/AuthProvider';
import { methodSplit } from '../../overview/selectors';
import { percentSplit } from '../selectors';
import { SourcesBars } from '../components/SourcesBars';
import { DownloadRegisterButton } from '../components/DownloadRegisterButton';
import type { AttendanceRecord } from '../../../core/api/schemas/attendance';

export const CheckinSourcesCard: React.FC<WidgetProps> = () => {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const scope: 'mine' | 'all' = user?.role?.toLowerCase().includes('teacher') ? 'mine' : 'all';
  const role: Role = normalizeRole(user?.role || 'student');
  const canExport = can(role, 'reports.export');

  // Query records for 'week' as specified
  const query = useRecords({
    range: 'week',
    scope,
  });

  const { data: records, refetch } = query;

  const methodData = useMemo(() => methodSplit(records), [records]);
  const percentData = useMemo(() => percentSplit(methodData), [methodData]);

  const kebabMenu = (
    <div className="relative">
      <button
        type="button"
        aria-label="Options for Check-in Sources"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((prev) => !prev);
        }}
        className="text-[#9ca3af] hover:text-white p-1 rounded-md hover:bg-[#2a2b31]/60 transition-colors shrink-0"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
            }}
          />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 w-32 rounded-lg bg-[#1e1f24] border border-[#2a2b31] shadow-2xl py-1 z-50 text-xs text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                refetch();
              }}
              className="w-full text-left px-3 py-2 hover:bg-[#2a2b31] hover:text-white transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <WidgetShell<AttendanceRecord[]>
      query={query}
      skeleton={<SkeletonCard className="p-5 min-h-[300px]" lines={4} />}
    >
      {() => (
        <ChartCard
          title="Check-in Sources"
          toolbar={kebabMenu}
          className="min-h-[300px] flex flex-col justify-between"
        >
          <div className="space-y-4">
            {/* Top Visual: 5 vertical bars cluster */}
            <div className="flex justify-center pb-1">
              <SourcesBars methodCounts={methodData} />
            </div>

            {/* Rows from methodSplit with colors and largest-remainder percentages */}
            <div className="space-y-2.5 pt-1">
              {/* QR scan */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <LegendSquare color="#6366f1" label="QR scan" />
                </div>
                <span className="font-semibold text-white tabular-nums">
                  {percentData.qr.toFixed(1)}%
                </span>
              </div>

              {/* Face-verified */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <LegendSquare color="#8b5cf6" label="Face-verified" />
                </div>
                <span className="font-semibold text-white tabular-nums">
                  {percentData.face.toFixed(1)}%
                </span>
              </div>

              {/* Kiosk */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <LegendSquare color="#a78bfa" label="Kiosk" />
                </div>
                <span className="font-semibold text-white tabular-nums">
                  {percentData.kiosk.toFixed(1)}%
                </span>
              </div>

              {/* Manual */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <LegendSquare color="#c4b5fd" label="Manual" />
                </div>
                <span className="font-semibold text-white tabular-nums">
                  {percentData.manual.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Footer (border-t): left muted 'Weekly register', right DownloadRegisterButton */}
          {canExport && (
            <div className="border-t border-[#2a2b31]/40 pt-3 mt-4 flex items-center justify-between">
              <span className="text-xs text-[#9ca3af]">Weekly register</span>
              <DownloadRegisterButton />
            </div>
          )}
        </ChartCard>
      )}
    </WidgetShell>
  );
};
