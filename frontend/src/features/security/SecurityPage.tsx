import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Filter,
  FileWarning,
} from 'lucide-react';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useSecurityAuditLogsQuery } from './hooks';
import { QueueRowActions } from './components/QueueRowActions';
import { normalizeQueueItem, NormalizedQueueItem } from './selectors';
import { setBadge } from '../../core/badges';

export const SecurityPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') === 'spoof' ? 'spoof' : 'alerts';

  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  const query = useSecurityAuditLogsQuery(100);
  const rawLogs = Array.isArray(query.data) ? query.data : (query.data as any)?.items || [];

  // Publish security.alerts badge
  useEffect(() => {
    const openCount = rawLogs.filter((l: any) => {
      const isDismissed = (l.details || '').includes('DISMISSED');
      return !isDismissed;
    }).length;
    setBadge('security.alerts', openCount);
  }, [rawLogs]);

  const handleTabChange = (tab: 'alerts' | 'spoof') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'spoof') {
        next.set('tab', 'spoof');
      } else {
        next.delete('tab');
      }
      return next;
    });
  };

  const filteredItems = useMemo(() => {
    return rawLogs.filter((item: any) => {
      const eventType = (item.event_type || item.action || '').toLowerCase();
      const details = (item.details || '').toLowerCase();
      const isSpoof =
        eventType.includes('spoof') ||
        eventType.includes('proxy') ||
        eventType.includes('bypass') ||
        details.includes('spoof') ||
        details.includes('device mismatch');

      if (currentTab === 'spoof' && !isSpoof) return false;

      // Severity filter
      const severity = (item.severity || (isSpoof ? 'high' : 'medium')).toLowerCase();
      if (severityFilter !== 'all' && severity !== severityFilter) return false;

      // Status filter
      const isDismissed = details.includes('dismissed');
      const isEscalated = details.includes('escalated');
      const status = isDismissed ? 'dismissed' : isEscalated ? 'escalated' : 'open';
      if (statusFilter !== 'all' && status !== statusFilter) return false;

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const roll = (item.roll_number || '').toLowerCase();
        const userStr = (item.username || '').toLowerCase();
        return eventType.includes(q) || details.includes(q) || roll.includes(q) || userStr.includes(q);
      }

      return true;
    });
  }, [rawLogs, currentTab, severityFilter, statusFilter, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security & Audit Operations"
        description="Real-time biometric spoof logs, hardware anomaly detections, and security incident response"
      />

      {/* Tabs: Alerts | Spoof Log */}
      <div className="flex items-center gap-2 border-b border-[#2a2b31] pb-3">
        <button
          type="button"
          onClick={() => handleTabChange('alerts')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
            currentTab === 'alerts'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-[#9ca3af] hover:text-white hover:bg-[#1e1f24]'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Security Alerts</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('spoof')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
            currentTab === 'spoof'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-[#9ca3af] hover:text-white hover:bg-[#1e1f24]'
          }`}
        >
          <Flame className="w-4 h-4" />
          <span>Spoof Log</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/20 text-white">
            Preset
          </span>
        </button>
      </div>

      <ChartCard
        title={currentTab === 'spoof' ? 'Biometric & QR Spoof Incident Log' : 'Institutional Security Alerts'}
        subtitle={
          currentTab === 'spoof'
            ? 'Filtered exclusively for unauthorized device sharing, GPS spoofing, and proxy QR attacks'
            : 'All recorded security telemetry events and hardware challenge audits'
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Severity Filter */}
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="h-8 px-2 rounded-lg bg-[#141416] border border-[#2a2b31] text-xs text-white"
            >
              <option value="all">All Severities</option>
              <option value="high">High Severity</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 px-2 rounded-lg bg-[#141416] border border-[#2a2b31] text-xs text-white"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="dismissed">Dismissed</option>
              <option value="escalated">Escalated</option>
            </select>

            {/* Search Input */}
            <div className="relative w-44">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search log..."
                className="h-8 pl-8 text-xs bg-[#141416] border-[#2a2b31] text-white"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="h-8 px-2.5 text-xs border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-slate-300"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin text-indigo-400' : ''}`}
              />
            </Button>
          </div>
        }
      >
        {query.isError && (
          <div className="p-8 text-center bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-rose-200">Unable to load security telemetry</h4>
            <p className="text-xs text-rose-300/80 mt-1 max-w-sm mx-auto">
              {(query.error as any)?.message || 'Service could not be reached.'}
            </p>
          </div>
        )}

        {query.isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full bg-[#2a2b31]/40 animate-pulse rounded flex items-center justify-between px-4"
              >
                <div className="h-3 w-28 bg-[#2a2b31] rounded" />
                <div className="h-3 w-48 bg-[#2a2b31] rounded" />
                <div className="h-3 w-20 bg-[#2a2b31] rounded" />
              </div>
            ))}
          </div>
        )}

        {!query.isLoading && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Event / Incident</th>
                  <th className="py-2.5 px-3">Student / Entity</th>
                  <th className="py-2.5 px-3">Details</th>
                  <th className="py-2.5 px-3">Severity</th>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[#9ca3af]">
                      No security incidents match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((log: any) => {
                    const normItem: NormalizedQueueItem = normalizeQueueItem(log, 'spoof');
                    const isHigh =
                      normItem.severity === 'high' ||
                      (log.event_type || '').includes('SPOOF') ||
                      (log.event_type || '').includes('PROXY');

                    return (
                      <tr
                        key={log.id}
                        className="hover:bg-[#2a2b31]/30 transition-colors group"
                      >
                        <td className="py-3 px-3 font-semibold text-white">
                          <div className="flex items-center gap-2">
                            {isHigh ? (
                              <Flame className="w-4 h-4 text-rose-400 shrink-0" />
                            ) : (
                              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                            )}
                            <span>{log.event_type || 'SECURITY_EVENT'}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-indigo-400">
                          {log.roll_number || log.username || 'SYSTEM'}
                        </td>
                        <td className="py-3 px-3 text-slate-300 max-w-sm truncate">
                          {log.details || 'Automated hardware defense telemetry trigger'}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              isHigh
                                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            }`}
                          >
                            {isHigh ? 'High' : 'Medium'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[#9ca3af] font-mono text-[11px]">
                          {log.timestamp ? log.timestamp.slice(0, 16).replace('T', ' ') : 'Recent'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex justify-end">
                            <QueueRowActions item={normItem} />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
};

export default SecurityPage;
