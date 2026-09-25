import React from 'react';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  CalendarDays,
  QrCode,
  ScanFace,
  Smartphone,
  FileSpreadsheet,
  PanelLeftClose,
  PanelLeftOpen,
  HelpCircle,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { RailNavigationItem } from '../../services/mockApi';

interface IconRailProps {
  items: RailNavigationItem[];
  activeId: string;
  onSelect: (id: string) => void;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

// Icon mapper for dynamic typed rail items
const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  LayoutDashboard,
  Users,
  GraduationCap,
  CalendarDays,
  QrCode,
  ScanFace,
  Smartphone,
  FileSpreadsheet,
};

export const IconRail: React.FC<IconRailProps> = ({
  items,
  activeId,
  onSelect,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  // Fallback items if empty during initial load
  const displayItems: RailNavigationItem[] = items.length === 8 ? items : [
    { id: 'dashboard', label: 'Dashboard', iconName: 'LayoutDashboard', path: '/admin', tooltip: 'Live Attendance Overview' },
    { id: 'students', label: 'Students', iconName: 'Users', path: '/admin/management', tooltip: 'Student Master Directory' },
    { id: 'faculty', label: 'Faculty', iconName: 'GraduationCap', path: '/teacher', tooltip: 'Faculty Roster & Class Dispatch' },
    { id: 'sessions', label: 'Sessions', iconName: 'CalendarDays', path: '/admin/management', tooltip: 'Timetable & Class Schedules' },
    { id: 'qr-gateways', label: 'QR Hub', iconName: 'QrCode', path: '/qr', tooltip: 'Projector QR Gateways' },
    { id: 'biometrics', label: 'Face AI', iconName: 'ScanFace', path: '/admin', tooltip: 'Face Verification & Biometrics' },
    { id: 'devices', label: 'Devices', iconName: 'Smartphone', path: '/admin', tooltip: 'Device Binding & Telemetry' },
    { id: 'reports', label: 'Reports', iconName: 'FileSpreadsheet', path: '/reports', tooltip: 'Compliance & Export Reports' },
  ];

  return (
    <aside
      aria-label="Primary Navigation Rail"
      className="w-[56px] min-w-[56px] max-w-[56px] h-screen sticky top-0 flex flex-col items-center justify-between py-3.5 bg-[#111113] border-r border-[#2a2b31] z-30 select-none transition-colors"
    >
      {/* Top: Logo & Rail Navigation Icons */}
      <div className="flex flex-col items-center gap-4 w-full">
        {/* University Emblem / Logo */}
        <Tooltip position="right">
          <TooltipTrigger asChild>
            <button
              onClick={() => onSelect('dashboard')}
              className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#6366f1] via-[#7c3aed] to-[#8b5cf6] p-0.5 flex items-center justify-center shadow-lg shadow-indigo-500/25 hover:scale-105 active:scale-95 transition-transform"
              aria-label="SNIST Attendance ERP Home"
            >
              <div className="w-full h-full bg-[#141416] rounded-[10px] flex items-center justify-center">
                <span className="font-extrabold text-[13px] tracking-tighter bg-gradient-to-r from-white to-indigo-200 bg-clip-text text-transparent">
                  SN
                </span>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            SNIST Attendance ERP
          </TooltipContent>
        </Tooltip>

        <div className="w-7 h-[1px] bg-[#2a2b31]" />

        {/* 8 Icon Buttons with Tooltips */}
        <nav className="flex flex-col items-center gap-1.5 w-full px-1.5">
          {displayItems.map((item) => {
            const IconComponent = ICON_MAP[item.iconName] || LayoutDashboard;
            const isActive = activeId === item.id;

            return (
              <Tooltip key={item.id} position="right">
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelect(item.id)}
                    aria-label={item.tooltip}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      isActive
                        ? 'bg-[#1e1f24] text-white shadow-sm border border-[#2a2b31]'
                        : 'text-[#9ca3af] hover:text-white hover:bg-[#1e1f24]/60'
                    }`}
                  >
                    {/* Active Left Indicator Bar */}
                    {isActive && (
                      <span className="absolute -left-1.5 top-2 bottom-2 w-1 rounded-r-full bg-gradient-to-b from-[#6366f1] to-[#8b5cf6] shadow-sm shadow-indigo-500" />
                    )}
                    <IconComponent className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-white">{item.label}</span>
                    <span className="text-[10px] text-[#9ca3af]">{item.tooltip}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </div>

      {/* Bottom: Collapse Sidebar Toggle & Help */}
      <div className="flex flex-col items-center gap-1.5 w-full px-1.5 pt-2 border-t border-[#2a2b31]">
        {/* Secondary Sidebar Toggle Button */}
        <Tooltip position="right">
          <TooltipTrigger asChild>
            <button
              onClick={onToggleSidebar}
              aria-label={isSidebarCollapsed ? 'Expand secondary sidebar' : 'Collapse secondary sidebar'}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-[#9ca3af] hover:text-white hover:bg-[#1e1f24] transition-colors"
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isSidebarCollapsed ? 'Expand secondary sidebar' : 'Collapse secondary sidebar'}
          </TooltipContent>
        </Tooltip>

        {/* Quick Help */}
        <Tooltip position="right">
          <TooltipTrigger asChild>
            <button
              aria-label="Documentation and Help"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-[#9ca3af] hover:text-white hover:bg-[#1e1f24] transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            Support & University Manual
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
};
