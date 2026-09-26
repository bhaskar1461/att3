import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ShieldAlert, Smartphone, Mail, CheckCircle2 } from 'lucide-react';
import { useAlerts, AlertItem } from '../../../features/security/hooks';
import { useNotificationsLastRead, setLastRead } from '../../notifications';
import { formatRelativeTime } from '../../../features/security/selectors';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../components/ui/tooltip';

export const NotificationsBell: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  const lastRead = useNotificationsLastRead();

  const { data: alerts = [], isLoading } = useAlerts({
    status: 'open',
    pollMs: 60_000,
  });

  // Calculate unread open alerts (created_at > lastRead)
  const unreadAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (alert.status !== 'OPEN') return false;
      const ts = new Date(alert.created_at).getTime();
      return !isNaN(ts) && ts > lastRead;
    });
  }, [alerts, lastRead]);

  const unreadCount = unreadAlerts.length;

  // Latest 8 alerts for the dropdown
  const latestAlerts = useMemo(() => {
    return alerts.slice(0, 8);
  }, [alerts]);

  // Keyboard navigation & Focus management
  useEffect(() => {
    if (open) {
      // Focus first row on open
      requestAnimationFrame(() => {
        firstItemRef.current?.focus();
      });

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      };

      const handleOutsideClick = (e: MouseEvent) => {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(e.target as Node) &&
          triggerRef.current &&
          !triggerRef.current.contains(e.target as Node)
        ) {
          setOpen(false);
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('mousedown', handleOutsideClick);

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('mousedown', handleOutsideClick);
      };
    }
  }, [open]);

  const handleMarkAllRead = () => {
    setLastRead(Date.now());
  };

  const handleAlertClick = (alert: AlertItem) => {
    setOpen(false);
    triggerRef.current?.focus();

    if (alert.type === 'spoof') {
      navigate(`/security?tab=spoof&open=${alert.id}`);
    } else if (alert.type === 'recovery') {
      navigate(`/devices/recoveries?open=${alert.id}`);
    } else if (alert.type === 'onboarding') {
      navigate(`/onboarding?open=${alert.id}`);
    } else {
      navigate(`/security?open=${alert.id}`);
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'spoof':
        return (
          <div className="w-7 h-7 rounded-lg bg-rose-500/15 border border-rose-500/25 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
        );
      case 'recovery':
        return (
          <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-amber-400" />
          </div>
        );
      case 'onboarding':
        return (
          <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-purple-400" />
          </div>
        );
      default:
        return (
          <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4 text-indigo-400" />
          </div>
        );
    }
  };

  return (
    <div className="relative">
      <Tooltip position="bottom">
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={
              unreadCount > 0
                ? `${unreadCount} unread security notifications`
                : 'Notifications'
            }
            aria-expanded={open}
            aria-haspopup="true"
            className="relative w-9 h-9 rounded-xl bg-[#1e1f24] hover:bg-[#25262c] border border-[#2a2b31] hover:border-slate-600 text-[#9ca3af] hover:text-white flex items-center justify-center transition-colors"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white font-mono shadow-md ring-2 ring-[#17181c] animate-in fade-in zoom-in duration-200">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {unreadCount > 0
            ? `${unreadCount} unread alert${unreadCount === 1 ? '' : 's'}`
            : 'Notifications'}
        </TooltipContent>
      </Tooltip>

      {open && (
        <div
          ref={dropdownRef}
          role="dialog"
          aria-label="Notifications Dropdown"
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-[#1e1f24] border border-[#2a2b31] shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2b31] bg-[#1a1b1f]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono text-[10px] font-bold">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Alert rows container (max-h 380px scroll) */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-[#2a2b31]/50 focus:outline-none">
            {isLoading ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Loading notifications...
              </div>
            ) : latestAlerts.length === 0 ? (
              <div className="py-10 px-4 text-center flex flex-col items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400/60 mb-2" />
                <p className="text-xs font-medium text-slate-300">
                  You're all caught up.
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  No pending security alerts or anomalies.
                </p>
              </div>
            ) : (
              latestAlerts.map((alert, idx) => {
                const isUnread =
                  alert.status === 'OPEN' &&
                  new Date(alert.created_at).getTime() > lastRead;

                return (
                  <button
                    key={alert.id}
                    ref={idx === 0 ? firstItemRef : undefined}
                    type="button"
                    onClick={() => handleAlertClick(alert)}
                    className={`w-full text-left p-3.5 flex items-start gap-3 hover:bg-[#25262c] focus:bg-[#25262c] focus:outline-none transition-colors ${
                      isUnread ? 'bg-indigo-950/15' : ''
                    }`}
                  >
                    {renderIcon(alert.type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`text-xs font-semibold truncate ${
                            isUnread ? 'text-white' : 'text-slate-300'
                          }`}
                        >
                          {alert.title}
                        </span>
                        <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                          {formatRelativeTime(alert.created_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {alert.subtitle || alert.action}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            alert.severity === 'critical'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : alert.severity === 'high'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {alert.severity}
                        </span>
                        {alert.status === 'RESOLVED' && (
                          <span className="text-[9px] font-semibold text-slate-500">
                            Resolved
                          </span>
                        )}
                        {alert.status === 'ESCALATED' && (
                          <span className="text-[9px] font-semibold text-amber-400">
                            Escalated
                          </span>
                        )}
                      </div>
                    </div>
                    {isUnread && (
                      <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 self-center" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#17181c] border-t border-[#2a2b31] text-xs">
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-slate-400 hover:text-slate-200 transition-colors text-[11px]"
            >
              Mark all read
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/security');
              }}
              className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors text-[11px]"
            >
              View all →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
