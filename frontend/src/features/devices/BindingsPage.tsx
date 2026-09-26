import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Smartphone,
  Search,
  RefreshCw,
  AlertCircle,
  MoreVertical,
  ShieldAlert,
  Calendar,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { api } from '../../core/api/client';
import { z } from 'zod';

export interface DeviceBindingItem {
  id: number;
  roll_number: string;
  name: string;
  department_code: string;
  device_bound: boolean;
  binding_status: 'hard' | 'unbound';
  enrolled_key_id?: string | null;
  device_info?: {
    id?: number;
    key_id?: string;
    public_id?: string;
    is_active?: boolean;
    enrolled_at?: string;
    enrolled_via?: string;
    last_seen_at?: string;
  } | null;
}

export const BindingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>('');
  const [activeKebabId, setActiveKebabId] = useState<number | null>(null);
  const [revokeConfirmTarget, setRevokeConfirmTarget] = useState<DeviceBindingItem | null>(null);

  // Fetch all students with their device bindings (dept_id=-1 fetches all)
  const bindingsQuery = useQuery({
    queryKey: ['devices', 'bindings'],
    queryFn: () => api<DeviceBindingItem[]>('/api/v1/admin/department-enrolled-students?dept_id=-1', z.any()),
  });

  const revokeMutation = useMutation({
    mutationFn: async (target: DeviceBindingItem) => {
      try {
        return await api('/api/v1/binding/admin/reset-student-binding', z.any(), {
          method: 'POST',
          body: JSON.stringify({
            student_id: target.id,
            roll_number: target.roll_number,
            reason: 'ADMIN_RESET',
            notes: 'Administrative reset from Hardware Device Bindings dashboard'
          }),
        });
      } catch {
        try {
          return await api(`/api/v1/binding/admin/revoke/${target.id}`, z.any(), {
            method: 'POST',
          });
        } catch {
          // Fallback to generic devices revoke endpoint
          return await api('/api/v1/devices/reset-student-enrollment', z.any(), {
            method: 'POST',
            body: JSON.stringify({ student_id: target.id, roll_number: target.roll_number }),
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', 'bindings'] });
      setRevokeConfirmTarget(null);
      setActiveKebabId(null);
    },
  });

  const allItems: DeviceBindingItem[] = Array.isArray(bindingsQuery.data) ? bindingsQuery.data : [];

  const filteredItems = allItems.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.roll_number.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      (item.department_code || '').toLowerCase().includes(q) ||
      (item.enrolled_key_id || '').toLowerCase().includes(q)
    );
  });

  const handleRevokeConfirm = async () => {
    if (!revokeConfirmTarget) return;
    try {
      await revokeMutation.mutateAsync(revokeConfirmTarget);
    } catch (err: any) {
      alert(`Revocation failed: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hardware Device Bindings"
        description="Cryptographic hardware key bindings, active device locks, and institutional fraud prevention"
      />

      <ChartCard
        title="Registered Device Bindings"
        subtitle={`${allItems.length} enrolled students tracked for 1-device enforcement`}
        toolbar={
          <div className="flex items-center gap-3">
            <div className="relative w-48 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search student, roll, key..."
                className="h-8 pl-8 text-xs bg-[#141416] border-[#2a2b31] text-white focus-visible:ring-indigo-500"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bindingsQuery.refetch()}
              disabled={bindingsQuery.isFetching}
              className="h-8 px-2.5 text-xs border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-slate-300"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${bindingsQuery.isFetching ? 'animate-spin text-indigo-400' : ''}`}
              />
            </Button>
          </div>
        }
      >
        {bindingsQuery.isError && (
          <div className="p-8 text-center bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-rose-200">Unable to load device bindings</h4>
            <p className="text-xs text-rose-300/80 mt-1 max-w-sm mx-auto">
              {(bindingsQuery.error as any)?.message || 'Service could not be reached.'}
            </p>
          </div>
        )}

        {bindingsQuery.isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full bg-[#2a2b31]/40 animate-pulse rounded flex items-center justify-between px-4"
              >
                <div className="h-3 w-28 bg-[#2a2b31] rounded" />
                <div className="h-3 w-40 bg-[#2a2b31] rounded" />
                <div className="h-3 w-20 bg-[#2a2b31] rounded" />
              </div>
            ))}
          </div>
        )}

        {!bindingsQuery.isLoading && !bindingsQuery.isError && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Student</th>
                  <th className="py-2.5 px-3">Device Identity</th>
                  <th className="py-2.5 px-3">Bound At</th>
                  <th className="py-2.5 px-3">Last Seen</th>
                  <th className="py-2.5 px-3">Binding Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#9ca3af]">
                      No device records match "{search}".
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const isBound = item.device_bound || Boolean(item.enrolled_key_id);
                    const keyId = item.device_info?.key_id || item.enrolled_key_id || 'KEY-PRIMARY';
                    const boundAt = item.device_info?.enrolled_at || 'Active Semester';
                    const lastSeen = item.device_info?.last_seen_at || 'Recent';
                    const isKebabOpen = activeKebabId === item.id;

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-[#2a2b31]/30 transition-colors group"
                      >
                        <td className="py-2.5 px-3 font-medium text-white">
                          <div className="font-semibold">{item.name}</div>
                          <div className="text-[11px] text-indigo-400 font-mono">
                            {item.roll_number} · {item.department_code}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {isBound ? (
                            <div className="flex items-center gap-1.5 font-mono text-slate-300">
                              <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                              <span>{keyId.slice(0, 16)}...</span>
                            </div>
                          ) : (
                            <span className="text-slate-500 italic">No device bound</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[#9ca3af] font-mono text-[11px]">
                          {isBound ? boundAt : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-[#9ca3af] font-mono text-[11px]">
                          {isBound ? lastSeen : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              isBound
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                            }`}
                          >
                            {isBound ? 'Bound (Hardware Locked)' : 'Unbound'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right relative">
                          {isBound ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setActiveKebabId(isKebabOpen ? null : item.id)}
                                className="h-7 w-7 p-0 text-[#9ca3af] hover:text-white hover:bg-[#2a2b31]"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>

                              {isKebabOpen && (
                                <div
                                  className="absolute right-3 top-8 z-30 w-36 rounded-xl bg-[#1e1f24] border border-[#2a2b31] shadow-xl py-1 text-left text-xs animate-in fade-in zoom-in-95 duration-100"
                                  onMouseLeave={() => setActiveKebabId(null)}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveKebabId(null);
                                      setRevokeConfirmTarget(item);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-rose-400 hover:bg-rose-500/10 transition-colors"
                                  >
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                    <span>Revoke Binding</span>
                                  </button>
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-600 text-[11px]">—</span>
                          )}
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

      {/* Destructive Confirm Dialog */}
      {revokeConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#1e1f24] border border-[#2a2b31] w-full max-w-sm rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-white">Revoke Hardware Binding?</h3>
              <p className="text-xs text-[#9ca3af] leading-relaxed">
                This will immediately unlink the physical device for{' '}
                <strong className="text-white">{revokeConfirmTarget.name}</strong> (
                {revokeConfirmTarget.roll_number}). The student will need administrative re-approval or OTP verification to bind a new device.
              </p>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevokeConfirmTarget(null)}
                className="border-[#2a2b31] text-slate-300 hover:bg-[#2a2b31]"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={revokeMutation.isPending}
                onClick={handleRevokeConfirm}
                className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
              >
                {revokeMutation.isPending ? 'Revoking...' : 'Confirm Revocation'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BindingsPage;
