import React from 'react';
import {
  Sun,
  Moon,
  Calendar,
  Menu,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useDashboardHeader } from '../../hooks/useDashboardHeader';
import { useTheme } from '../../hooks/useTheme';
import { GlobalSearch } from '../../core/components/topbar/GlobalSearch';
import { PresentTodayPill } from '../../core/components/topbar/PresentTodayPill';
import { NotificationsBell } from '../../core/components/topbar/NotificationsBell';
import { AvatarMenu } from '../../core/components/topbar/AvatarMenu';

interface TopbarProps {
  isMobileSidebarOpen: boolean;
  onToggleMobileSidebar: () => void;
  onOpenSearch?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  isMobileSidebarOpen,
  onToggleMobileSidebar,
}) => {
  const { currentDateFormatted } = useDashboardHeader();
  const { isDark, toggleTheme } = useTheme();

  return (
    <header className="h-16 w-full sticky top-0 bg-[#17181c] border-b border-[#2a2b31] px-4 sm:px-6 flex items-center justify-between gap-3 z-20 select-none">
      {/* Left: Mobile Menu Toggle & Global Search Combobox */}
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        {/* Mobile Hamburger Toggle (Visible < 1024px) */}
        <button
          onClick={onToggleMobileSidebar}
          aria-label={isMobileSidebarOpen ? 'Close navigation' : 'Open navigation'}
          className="lg:hidden p-2 rounded-xl bg-[#1e1f24] text-[#9ca3af] hover:text-white border border-[#2a2b31] transition-colors"
        >
          {isMobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Global Search Combobox */}
        <div className="w-full max-w-md">
          <GlobalSearch />
        </div>
      </div>

      {/* Right: Live Pill, Theme Toggle, Calendar, Notifications, Avatar */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        
        {/* Live Pill "Present today: {n}" */}
        <PresentTodayPill />

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

        {/* Notification Bell with Live Dropdown & Unread Counter */}
        <NotificationsBell />

        {/* User Initials Avatar & Actions Menu */}
        <div className="pl-1 sm:pl-2 border-l border-[#2a2b31]">
          <AvatarMenu />
        </div>

      </div>
    </header>
  );
};

