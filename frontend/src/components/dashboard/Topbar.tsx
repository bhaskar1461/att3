import React from 'react';
import {
  Search,
  Sun,
  Moon,
  Bell,
  Calendar,
  Menu,
  X,
  Command,
  Layers,
  LogOut,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '../ui/avatar';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useDashboardHeader } from '../../hooks/useDashboardHeader';
import { useTheme } from '../../hooks/useTheme';
import { useAuth } from '../../context/AuthContext';

interface TopbarProps {
  isMobileSidebarOpen: boolean;
  onToggleMobileSidebar: () => void;
  onOpenSearch?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  isMobileSidebarOpen,
  onToggleMobileSidebar,
}) => {
  const { livePillText, user, notificationCount, currentDateFormatted } = useDashboardHeader();
  const { isDark, toggleTheme } = useTheme();
  const { logout } = useAuth();

  return (
    <header className="h-16 w-full sticky top-0 bg-[#17181c] border-b border-[#2a2b31] px-4 sm:px-6 flex items-center justify-between gap-3 z-20 select-none">
      {/* Left: Mobile Menu Toggle & Global Search Input */}
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        {/* Mobile Hamburger Toggle (Visible < 1024px) */}
        <button
          onClick={onToggleMobileSidebar}
          aria-label={isMobileSidebarOpen ? 'Close navigation' : 'Open navigation'}
          className="lg:hidden p-2 rounded-xl bg-[#1e1f24] text-[#9ca3af] hover:text-white border border-[#2a2b31] transition-colors"
        >
          {isMobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Global Search Input */}
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af] pointer-events-none" />
          <input
            type="text"
            placeholder="Search students, SAP ID, classes..."
            className="w-full h-9 pl-9 pr-14 rounded-[10px] bg-[#1e1f24] border border-[#2a2b31] text-xs text-white placeholder:text-[#9ca3af] focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
            aria-label="Global search students and classes"
          />
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-[#2a2b31] bg-[#141416] text-[10px] text-[#9ca3af] font-mono">
            <Command className="w-2.5 h-2.5" />
            <span>K</span>
          </div>
        </div>
      </div>

      {/* Right: Live Pill, Theme Toggle, Calendar, Notifications, Avatar */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        
        {/* Live Pill "Present today: —" */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1e1f24] border border-[#2a2b31] text-xs shadow-sm">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-semibold text-slate-200 tracking-tight text-[11px] sm:text-xs">
            {livePillText}
          </span>
        </div>

        {/* Calendar Icon & IST Date Badge (Hidden on very narrow mobile < 640px) */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#1e1f24] border border-[#2a2b31] text-xs text-[#9ca3af]">
          <Calendar className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-[11px] font-medium text-slate-300">
            {currentDateFormatted}
          </span>
        </div>

        {/* Light / Dark Mode Toggle */}
        <Tooltip position="bottom">
          <TooltipTrigger asChild>
            <button
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-9 h-9 rounded-xl bg-[#1e1f24] hover:bg-[#25262c] border border-[#2a2b31] text-[#9ca3af] hover:text-white flex items-center justify-center transition-colors"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400 transition-transform hover:rotate-45" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-400 transition-transform hover:-rotate-12" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          </TooltipContent>
        </Tooltip>

        {/* Notification Bell with Dot */}
        <Tooltip position="bottom">
          <TooltipTrigger asChild>
            <button
              aria-label="Notifications"
              className="relative w-9 h-9 rounded-xl bg-[#1e1f24] hover:bg-[#25262c] border border-[#2a2b31] text-[#9ca3af] hover:text-white flex items-center justify-center transition-colors"
            >
              <Bell className="w-4 h-4" />
              {notificationCount > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] ring-2 ring-[#17181c]" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {notificationCount} Alerts & Notifications
          </TooltipContent>
        </Tooltip>

        {/* Admin Operations Hub Button (Rule 3 Parity Access) */}
        <Tooltip position="bottom">
          <TooltipTrigger asChild>
            <Link
              to="/admin/legacy"
              aria-label="Open Admin Operations Center"
              className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Admin Ops Hub</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Open Classic Admin Operations & Management Tabs
          </TooltipContent>
        </Tooltip>

        {/* User Avatar + Name & Role */}
        <div className="flex items-center gap-2.5 pl-1 sm:pl-2 border-l border-[#2a2b31]">
          <Avatar
            fallback={user.avatarFallback}
            className="w-8 h-8 rounded-xl shadow-sm text-xs font-bold ring-1 ring-[#2a2b31]"
          />
          <div className="hidden lg:flex flex-col text-left leading-tight">
            <span className="text-xs font-bold text-white tracking-tight truncate max-w-[120px]">
              {user.name}
            </span>
            <span className="text-[10px] font-medium text-[#9ca3af] truncate max-w-[120px]">
              {user.role}
            </span>
          </div>

          <Tooltip position="bottom">
            <TooltipTrigger asChild>
              <button
                onClick={logout}
                aria-label="Sign Out"
                className="w-8 h-8 rounded-xl bg-[#1e1f24] hover:bg-red-500/20 border border-[#2a2b31] hover:border-red-500/40 text-[#9ca3af] hover:text-red-300 flex items-center justify-center transition-colors ml-1"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Sign Out
            </TooltipContent>
          </Tooltip>
        </div>

      </div>
    </header>
  );
};
