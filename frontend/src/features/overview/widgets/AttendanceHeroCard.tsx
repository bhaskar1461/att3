import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { WidgetProps } from '../../../core/types';
import { WidgetShell } from '../../../core/components/WidgetShell';
import { GradientHeroCard } from '../../../components/dashboard/GradientHeroCard';
import { LegendSquare } from '../../../components/dashboard/LegendSquare';
import { AttendanceGauge } from '../components/AttendanceGauge';
import { StatusBreakdown } from '../components/StatusBreakdown';
import { useRecords } from '../../attendance/hooks';
import { useAuth } from '../../auth/hooks';
import { statusSplit, methodSplit } from '../selectors';
import type { AttendanceRecord } from '../../../core/api/schemas/attendance';

export const AttendanceHeroCard: React.FC<WidgetProps> = ({ range = 'today' }) => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // Resolve shared URL param ?range (hero synchronizes with Trend Card control)
  const urlRange = searchParams.get('range');
  const currentRange: 'today' | 'week' | 'month' =
    urlRange === 'today' || urlRange === 'week' || urlRange === 'month'
      ? urlRange
      : (range as 'today' | 'week' | 'month') || 'today';

  // Teacher scope derived from role: teacher gets 'mine', admin gets 'all'
  const scope: 'mine' | 'all' = user?.role === 'teacher' ? 'mine' : 'all';

  const query = useRecords({
    range: currentRange,
    scope,
  });

  const { data: records, refetch } = query;

  const statusData = useMemo(() => statusSplit(records), [records]);
  const methodData = useMemo(() => methodSplit(records), [records]);

  const numFormat = useMemo(() => new Intl.NumberFormat(), []);

  const kebabMenu = (
    <div className="relative">
      <button
        type="button"
        aria-label="Attendance options"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((prev) => !prev);
        }}
        className="text-white/70 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
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
            className="absolute right-0 top-full mt-1.5 w-48 rounded-lg bg-[#1e1f24] border border-[#2a2b31] shadow-2xl py-1 z-50 text-xs text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                navigate('/compliance');
              }}
              className="w-full text-left px-3 py-2 hover:bg-[#2a2b31] hover:text-white transition-colors flex items-center justify-between"
            >
              <span>View compliance bands</span>
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                refetch();
              }}
              className="w-full text-left px-3 py-2 hover:bg-[#2a2b31] hover:text-white transition-colors flex items-center justify-between"
            >
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
      skeleton={<GradientHeroCard loading={true} className="min-h-[380px]" />}
      error={(_err, retry) => (
        <div className="relative overflow-hidden rounded-[12px] bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] p-6 text-white shadow-xl shadow-purple-500/15 border border-purple-400/30 min-h-[380px] flex flex-col justify-between">
          <div className="relative z-10 flex items-center justify-between gap-3 mb-4">
            <h3 className="text-[15px] font-semibold text-white tracking-tight">
              Overall Attendance
            </h3>
          </div>
          <div className="relative z-10 my-auto p-5 bg-white/10 rounded-lg text-center backdrop-blur-sm border border-white/20">
            <p className="text-xs text-white/90 mb-3.5 font-medium">
              Failed to load attendance metrics
            </p>
            <button
              onClick={retry}
              type="button"
              className="px-4 py-1.5 bg-white text-purple-900 text-xs font-semibold rounded-md hover:bg-white/90 transition-colors shadow-sm"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    >
      {() => (
        <GradientHeroCard
          title="Overall Attendance"
          menu={kebabMenu}
          className="min-h-[380px]"
        >
          {/* Section 2: Gauge Block */}
          <div className="my-1">
            <AttendanceGauge
              value={statusData.ratePct}
              total={statusData.total}
              range={currentRange}
            />
          </div>

          {/* Section 3: Sub-stat row (two or three cells) */}
          <div className="mt-4 flex items-center gap-2.5">
            {/* Cell 1: QR */}
            <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-white/10 min-w-0">
              <LegendSquare color="#ffffff" className="w-2.5 h-2.5 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] text-white/70 font-medium truncate">
                  QR
                </span>
                <span className="text-sm font-semibold text-white tabular-nums leading-tight">
                  {numFormat.format(methodData.qr)}
                </span>
              </div>
            </div>

            {/* Cell 2: Face-verified */}
            <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-white/10 min-w-0">
              <LegendSquare color="rgba(255, 255, 255, 0.5)" className="w-2.5 h-2.5 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] text-white/70 font-medium truncate">
                  Face-verified
                </span>
                <span className="text-sm font-semibold text-white tabular-nums leading-tight">
                  {numFormat.format(methodData.face)}
                </span>
              </div>
            </div>

            {/* Cell 3: Manual / Kiosk (only if > 0) */}
            {methodData.manual + methodData.kiosk > 0 && (
              <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-white/10 min-w-0">
                <LegendSquare color="rgba(255, 255, 255, 0.3)" className="w-2.5 h-2.5 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] text-white/70 font-medium truncate">
                    Manual/Kiosk
                  </span>
                  <span className="text-sm font-semibold text-white tabular-nums leading-tight">
                    {numFormat.format(methodData.manual + methodData.kiosk)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Status Breakdown */}
          <StatusBreakdown
            present={statusData.present}
            late={statusData.late}
            absent={statusData.absent}
            total={statusData.total}
          />
        </GradientHeroCard>
      )}
    </WidgetShell>
  );
};
