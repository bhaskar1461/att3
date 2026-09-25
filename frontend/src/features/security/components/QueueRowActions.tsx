import React from 'react';
import { toast } from 'sonner';
import { Check, X, ShieldAlert, RotateCw, Loader2 } from 'lucide-react';
import { NormalizedQueueItem } from '../selectors';
import { useAuth } from '../../auth/hooks';
import { can } from '../../../core/roles';
import {
  useOnboardingApproveRebindMutation,
  useOnboardingDenyRebindMutation,
  useOnboardingResendLinkMutation,
  useOnboardingRejectMutation,
} from '../../onboarding/hooks';
import {
  useSecurityDismissAlertMutation,
  useSecurityEscalateAlertMutation,
} from '../hooks';

export interface QueueRowActionsProps {
  item: NormalizedQueueItem;
}

export const QueueRowActions: React.FC<QueueRowActionsProps> = ({ item }) => {
  const { user } = useAuth();
  const role = (user?.role || '').toLowerCase() === 'teacher' ? 'teacher' : 'admin';

  // Mutations
  const approveRebind = useOnboardingApproveRebindMutation();
  const denyRebind = useOnboardingDenyRebindMutation();
  const dismissAlert = useSecurityDismissAlertMutation();
  const escalateAlert = useSecurityEscalateAlertMutation();
  const resendLink = useOnboardingResendLinkMutation();
  const rejectApproval = useOnboardingRejectMutation();

  // Role Gate check per queue type
  if (item.type === 'recoveries') {
    if (!can(role, 'devices.act')) return null;

    const isPending = approveRebind.isPending || denyRebind.isPending;

    const handleApprove = async () => {
      try {
        await approveRebind.mutateAsync(Number(item.rawId));
        toast.success('Device recovery approved');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to approve device recovery');
      }
    };

    const handleReject = async () => {
      try {
        await denyRebind.mutateAsync(Number(item.rawId));
        toast.success('Device recovery rejected');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to reject device recovery');
      }
    };

    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={handleApprove}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 disabled:opacity-50 transition-colors"
        >
          {approveRebind.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          Approve
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleReject}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 border border-rose-500/30 disabled:opacity-50 transition-colors"
        >
          {denyRebind.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <X className="w-3.5 h-3.5" />
          )}
          Reject
        </button>
      </div>
    );
  }

  if (item.type === 'spoof') {
    if (!can(role, 'security.act')) return null;

    const isPending = dismissAlert.isPending || escalateAlert.isPending;

    const handleDismiss = async () => {
      try {
        await dismissAlert.mutateAsync(item.rawId);
        toast.success('Security alert dismissed');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to dismiss security alert');
      }
    };

    const handleEscalate = async () => {
      try {
        await escalateAlert.mutateAsync(item.rawId);
        toast.success('Security alert escalated');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to escalate security alert');
      }
    };

    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={handleDismiss}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-600/40 disabled:opacity-50 transition-colors"
        >
          {dismissAlert.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          Dismiss
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleEscalate}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 border border-rose-500/30 disabled:opacity-50 transition-colors"
        >
          {escalateAlert.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5" />
          )}
          Escalate
        </button>
      </div>
    );
  }

  // approvals (onboarding requests)
  if (item.type === 'approvals') {
    if (!can(role, 'onboarding.act')) return null;

    const isPending = resendLink.isPending || rejectApproval.isPending;

    const handleResend = async () => {
      const roll = item.rollNumber || String(item.rawId);
      try {
        await resendLink.mutateAsync(roll);
        toast.success('Onboarding link resent to student');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to resend onboarding link');
      }
    };

    const handleReject = async () => {
      const roll = item.rollNumber || String(item.rawId);
      try {
        await rejectApproval.mutateAsync(roll);
        toast.success('Onboarding request rejected');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to reject onboarding request');
      }
    };

    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={handleResend}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-500/30 disabled:opacity-50 transition-colors"
        >
          {resendLink.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCw className="w-3.5 h-3.5" />
          )}
          Resend link
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleReject}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 border border-rose-500/30 disabled:opacity-50 transition-colors"
        >
          {rejectApproval.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <X className="w-3.5 h-3.5" />
          )}
          Reject
        </button>
      </div>
    );
  }

  return null;
};
