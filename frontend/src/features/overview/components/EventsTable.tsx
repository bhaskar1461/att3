import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../../core/auth/AuthProvider';
import { can } from '../../../core/roles';
import {
  AlertItem,
  useSecurityDismissAlertMutation,
  useSecurityEscalateAlertMutation,
} from '../../security/hooks';
import { formatRelativeTime } from '../../security/selectors';

interface EventsTableProps {
  alerts: AlertItem[];
}

export const EventsTable: React.FC<EventsTableProps> = ({ alerts }) => {
  const { role } = useAuth();
  const canAct = can(role, 'security.act');

  const dismissMutation = useSecurityDismissAlertMutation();
  const escalateMutation = useSecurityEscalateAlertMutation();

  const displayedAlerts = alerts.slice(0, 10);

  const handleDismiss = async (alert: AlertItem) => {
    try {
      await dismissMutation.mutateAsync(alert.id);
      toast.success(`Alert #${alert.id} dismissed`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to dismiss alert');
    }
  };

  const handleEscalate = async (alert: AlertItem) => {
    try {
      await escalateMutation.mutateAsync(alert.id);
      toast.success(`Alert #${alert.id} escalated to committee`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to escalate alert');
    }
  };

  if (alerts.length === 0) {
    return (
      <div className="py-12 text-center text-slate-400 text-xs">
        No flagged security events recorded.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#2a2b31] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 px-3">Time</th>
              <th className="py-2.5 px-3">Student</th>
              <th className="py-2.5 px-3">Type</th>
              <th className="py-2.5 px-3">Severity</th>
              <th className="py-2.5 px-3">Status</th>
              {canAct && <th className="py-2.5 px-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2b31]/40">
            {displayedAlerts.map((alert) => {
              const isResolved = alert.status === 'RESOLVED' || alert.status === 'ESCALATED';
              const isPending =
                dismissMutation.isPending || escalateMutation.isPending;

              return (
                <tr
                  key={alert.id}
                  className="hover:bg-[#25262c]/60 transition-colors"
                >
                  {/* Time (relative) */}
                  <td className="py-2.5 px-3 text-xs text-slate-400 font-mono whitespace-nowrap">
                    {formatRelativeTime(alert.created_at)}
                  </td>

                  {/* Student */}
                  <td className="py-2.5 px-3 text-xs font-mono font-medium text-indigo-400 whitespace-nowrap">
                    {alert.student}
                  </td>

                  {/* Type */}
                  <td className="py-2.5 px-3 text-xs text-slate-200 truncate max-w-[150px]">
                    <span className="capitalize">{alert.type}</span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {alert.action.replace(/_/g, ' ')}
                    </span>
                  </td>

                  {/* Severity pill */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        alert.severity === 'critical'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : alert.severity === 'high'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : alert.severity === 'medium'
                          ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {alert.severity}
                    </span>
                  </td>

                  {/* Status pill (muted if resolved) */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                        alert.status === 'OPEN'
                          ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          : 'bg-slate-800 text-slate-500 border border-slate-700'
                      }`}
                    >
                      {alert.status}
                    </span>
                  </td>

                  {/* Quick actions (Dismiss / Escalate) */}
                  {canAct && (
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {!isResolved ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDismiss(alert)}
                            disabled={isPending}
                            className="px-2 py-1 rounded bg-[#1e1f24] hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-300 border border-[#2a2b31] hover:border-emerald-500/30 text-[11px] font-semibold transition-colors disabled:opacity-40"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEscalate(alert)}
                            disabled={isPending}
                            className="px-2 py-1 rounded bg-[#1e1f24] hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 border border-[#2a2b31] hover:border-amber-500/30 text-[11px] font-semibold transition-colors disabled:opacity-40"
                          >
                            Escalate
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 italic">
                          Action complete
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Link */}
      <div className="pt-2 border-t border-[#2a2b31]/40 flex justify-end px-1">
        <Link
          to="/security"
          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
        >
          View all flagged events →
        </Link>
      </div>
    </div>
  );
};
