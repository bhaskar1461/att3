import React, { useState } from 'react';
import {
  UserCog,
  Search,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserX,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';
import { useAuth } from '../../core/auth/AuthProvider';

export interface AdminUser {
  id: number;
  username: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'TEACHER' | 'STUDENT';
  is_active: boolean;
  created_at: string;
}

export const UsersManagementPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState<string>('');
  const [roleChangeTarget, setRoleChangeTarget] = useState<AdminUser | null>(null);
  const [newSelectedRole, setNewSelectedRole] = useState<'SUPER_ADMIN' | 'TEACHER'>('TEACHER');

  // Baseline administrative users
  const [users, setUsers] = useState<AdminUser[]>([
    {
      id: 1,
      username: 'admin',
      name: 'System Administrator',
      email: 'admin@snist.edu',
      role: 'SUPER_ADMIN',
      is_active: true,
      created_at: '2024-01-01',
    },
    {
      id: 2,
      username: 'sowjanya.cse',
      name: 'Dr. Sowjanya Rao',
      email: 'sowjanya@snist.edu',
      role: 'TEACHER',
      is_active: true,
      created_at: '2024-02-15',
    },
    {
      id: 3,
      username: 'bhaskar.admin',
      name: 'Bhaskar Sharma (Admin)',
      email: 'bhaskar@snist.edu',
      role: 'SUPER_ADMIN',
      is_active: true,
      created_at: '2024-03-10',
    },
    {
      id: 4,
      username: 'principal.snist',
      name: 'Office of Principal',
      email: 'principal@snist.edu',
      role: 'SUPER_ADMIN',
      is_active: true,
      created_at: '2024-01-10',
    },
  ]);

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const isCurrentLoggedInUser = (u: AdminUser) => {
    if (!currentUser) return false;
    return currentUser.username === u.username || currentUser.id === u.id;
  };

  const handleToggleStatus = (target: AdminUser) => {
    if (isCurrentLoggedInUser(target)) return;
    setUsers((prev) =>
      prev.map((u) => (u.id === target.id ? { ...u, is_active: !u.is_active } : u))
    );
  };

  const handleConfirmRoleChange = () => {
    if (!roleChangeTarget) return;
    setUsers((prev) =>
      prev.map((u) => (u.id === roleChangeTarget.id ? { ...u, role: newSelectedRole } : u))
    );
    setRoleChangeTarget(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Administration"
        description="Institutional user accounts, role-based authorization, and administrative privilege governance"
      />

      <ChartCard
        title="Administrative & Faculty Users"
        subtitle="Manage roles and status; self-demotion is strictly locked out for governance safety"
        toolbar={
          <div className="flex items-center gap-3">
            <div className="relative w-48 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search user, name, email..."
                className="h-8 pl-8 text-xs bg-[#141416] border-[#2a2b31] text-white focus-visible:ring-indigo-500"
              />
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                <th className="py-2.5 px-3">User</th>
                <th className="py-2.5 px-3">Email Address</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Created</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
              {filteredUsers.map((u) => {
                const isSelf = isCurrentLoggedInUser(u);

                return (
                  <tr
                    key={u.id}
                    className="hover:bg-[#2a2b31]/30 transition-colors group"
                  >
                    <td className="py-3 px-3 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{u.name}</span>
                        {isSelf && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#9ca3af] font-mono">{u.username}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-300 text-[11px]">
                      {u.email}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          u.role === 'SUPER_ADMIN'
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                            : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                        }`}
                      >
                        {u.role === 'SUPER_ADMIN' ? 'Administrator' : 'Faculty'}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          u.is_active
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}
                      >
                        {u.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[#9ca3af] font-mono text-[11px]">
                      {u.created_at}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isSelf ? (
                          <Tooltip position="top">
                            <TooltipTrigger>
                              <div className="px-2.5 py-1 rounded bg-[#17181c] border border-[#2a2b31] text-[11px] text-[#9ca3af] flex items-center gap-1 cursor-not-allowed">
                                <Lock className="w-3 h-3 text-amber-400" />
                                <span>Locked</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              Self-demotion lockout enforced: you cannot alter your own administrative role or status.
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRoleChangeTarget(u);
                                setNewSelectedRole(u.role === 'SUPER_ADMIN' ? 'TEACHER' : 'SUPER_ADMIN');
                              }}
                              className="h-7 px-2 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 text-xs"
                            >
                              Change Role
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleStatus(u)}
                              className={`h-7 px-2 text-xs ${
                                u.is_active
                                  ? 'text-rose-400 hover:text-rose-300 hover:bg-rose-500/10'
                                  : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                              }`}
                            >
                              {u.is_active ? 'Disable' : 'Enable'}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {/* Role Change Confirm Dialog */}
      {roleChangeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#1e1f24] border border-[#2a2b31] w-full max-w-sm rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Change User Role</h3>
            <p className="text-xs text-[#9ca3af] leading-relaxed">
              Select the new authorization role for{' '}
              <strong className="text-white">{roleChangeTarget.name}</strong> ({roleChangeTarget.username}):
            </p>

            <div className="space-y-2">
              <select
                value={newSelectedRole}
                onChange={(e) => setNewSelectedRole(e.target.value as any)}
                className="w-full h-9 px-3 rounded-lg bg-[#141416] border border-[#2a2b31] text-white text-xs"
              >
                <option value="SUPER_ADMIN">Administrator (SUPER_ADMIN)</option>
                <option value="TEACHER">Faculty Educator (TEACHER)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRoleChangeTarget(null)}
                className="border-[#2a2b31] text-slate-300 hover:bg-[#2a2b31]"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmRoleChange}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              >
                Confirm Role Change
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersManagementPage;
