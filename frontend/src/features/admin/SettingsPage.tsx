import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  User,
  KeyRound,
  Sun,
  Moon,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAuth } from '../../core/auth/AuthProvider';
import { useTheme } from '../../hooks/useTheme';
import { api } from '../../core/api/client';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  // Password Change Form State
  const [oldPassword, setOldPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState<boolean>(false);

  // System Settings Query
  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async () => {
      try {
        return await api<Record<string, string>>('/api/v1/admin/settings', undefined);
      } catch {
        return {
          MIN_ATTENDANCE_PCT: '75',
          QR_ROTATION_SECONDS: '10',
          DEVICE_LOCK_MINUTES: '30',
          INSTITUTION_NAME: 'Sreenidhi Institute of Science & Technology',
        };
      }
    },
  });

  const [localSettings, setLocalSettings] = useState<Record<string, string>>({});
  React.useEffect(() => {
    if (settingsQuery.data) {
      setLocalSettings(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const updateSettingsMutation = useMutation({
    mutationFn: (newSettings: Record<string, string>) =>
      api('/api/v1/admin/settings', undefined, {
        method: 'POST',
        body: JSON.stringify({ settings: newSettings }),
      }),
    onSuccess: () => {
      toast.success('System settings saved successfully');
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update system settings');
    },
  });

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!oldPassword || !newPassword) {
      setPasswordError('Please provide both current and new passwords.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }

    setIsChangingPassword(true);
    try {
      await api('/api/v1/auth/change-password', undefined, {
        method: 'POST',
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      setPasswordSuccess('Password changed successfully.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password updated successfully');
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to update password. Verify current password.');
      toast.error(err.message || 'Failed to update password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettingsMutation.mutateAsync(localSettings);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & Preferences"
        description="Administrative parameters, personal credentials, and UI appearance preferences"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Profile Card */}
        <ChartCard
          title="User Profile"
          subtitle="Active session identity from server /auth/me"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-[#17181c] border border-[#2a2b31]">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                {(user?.full_name || user?.username || 'A').charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="text-sm font-bold text-white leading-tight">
                  {user?.full_name || 'System Administrator'}
                </h4>
                <p className="text-xs text-indigo-400 font-mono mt-0.5">{user?.username || 'admin'}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#17181c] border border-[#2a2b31] space-y-1">
                <span className="text-[#9ca3af]">Institutional Role</span>
                <p className="font-semibold text-white uppercase">{user?.role || 'SUPER_ADMIN'}</p>
              </div>
              <div className="p-3 rounded-xl bg-[#17181c] border border-[#2a2b31] space-y-1">
                <span className="text-[#9ca3af]">Primary Email</span>
                <p className="font-semibold text-white truncate">{user?.email || 'admin@snist.edu'}</p>
              </div>
            </div>
          </div>
        </ChartCard>

        {/* Appearance / Theme Card */}
        <ChartCard
          title="Appearance & Theme"
          subtitle="Customize dark or light aesthetic preference"
        >
          <div className="space-y-4">
            <p className="text-xs text-[#9ca3af] leading-relaxed">
              Toggle dashboard appearance. Preferred theme is persisted in local storage and applied on boot.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all ${
                  theme === 'dark'
                    ? 'bg-indigo-600/10 border-indigo-500 text-white font-semibold'
                    : 'bg-[#17181c] border-[#2a2b31] text-[#9ca3af] hover:text-white'
                }`}
              >
                <div className="p-2 rounded-lg bg-black/40 text-indigo-400">
                  <Moon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold">Dark Theme</div>
                  <div className="text-[10px] text-[#9ca3af]">Default OLED aesthetic</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all ${
                  theme === 'light'
                    ? 'bg-indigo-600/10 border-indigo-500 text-white font-semibold'
                    : 'bg-[#17181c] border-[#2a2b31] text-[#9ca3af] hover:text-white'
                }`}
              >
                <div className="p-2 rounded-lg bg-black/40 text-amber-400">
                  <Sun className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold">Light Theme</div>
                  <div className="text-[10px] text-[#9ca3af]">High contrast daylight</div>
                </div>
              </button>
            </div>
          </div>
        </ChartCard>

        {/* Password Change Card */}
        <ChartCard
          title="Security Credentials"
          subtitle="Update institutional login password (/api/v1/auth/change-password)"
        >
          <form onSubmit={handlePasswordSubmit} className="space-y-3 text-xs">
            {passwordError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                {passwordSuccess}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[#9ca3af] font-medium">Current Password</label>
              <Input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Enter current password"
                className="h-8 bg-[#141416] border-[#2a2b31] text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">New Password</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="h-8 bg-[#141416] border-[#2a2b31] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">Confirm New Password</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="h-8 bg-[#141416] border-[#2a2b31] text-white"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                size="sm"
                disabled={isChangingPassword}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs"
              >
                {isChangingPassword ? 'Updating...' : 'Update Password'}
              </Button>
            </div>
          </form>
        </ChartCard>

        {/* System Settings Parameters */}
        <ChartCard
          title="Institutional Parameters"
          subtitle="System-wide attendance cutoffs and security timeouts (/api/v1/admin/settings)"
        >
          <form onSubmit={handleSaveSettings} className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-[#9ca3af] font-medium">Minimum Attendance Threshold (%)</label>
              <Input
                value={localSettings['MIN_ATTENDANCE_PCT'] || '75'}
                onChange={(e) =>
                  setLocalSettings({ ...localSettings, MIN_ATTENDANCE_PCT: e.target.value })
                }
                className="h-8 bg-[#141416] border-[#2a2b31] text-white font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">QR Rotation Interval (sec)</label>
                <Input
                  value={localSettings['QR_ROTATION_SECONDS'] || '10'}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, QR_ROTATION_SECONDS: e.target.value })
                  }
                  className="h-8 bg-[#141416] border-[#2a2b31] text-white font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">Device Lockout Period (min)</label>
                <Input
                  value={localSettings['DEVICE_LOCK_MINUTES'] || '30'}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, DEVICE_LOCK_MINUTES: e.target.value })
                  }
                  className="h-8 bg-[#141416] border-[#2a2b31] text-white font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                size="sm"
                disabled={updateSettingsMutation.isPending}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Parameters</span>
              </Button>
            </div>
          </form>
        </ChartCard>
      </div>
    </div>
  );
};

export default SettingsPage;
