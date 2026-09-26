import React, { useMemo } from 'react';
import {
  LayoutDashboard,
  FileSpreadsheet,
  ShieldCheck,
  Users,
  GraduationCap,
  BookOpen,
  Smartphone,
  RefreshCw,
  Radio,
  History,
  ShieldAlert,
  UserPlus,
  UserCog,
  Settings,
  CalendarCheck,
  CalendarDays,
  QrCode,
  ScanFace,
  Activity,
  Sparkles,
} from 'lucide-react';
import { navRegistry } from '../../core/registries';
import { Role, NavEntry } from '../../core/types';
import { useBadge } from '../../core/badges';
import { ProInfoCardData } from '../../services/mockApi';
import '../../core/features';

interface SecondarySidebarProps {
  activeId: string;
  onSelect: (id: string) => void;
  isCollapsed: boolean;
  proCard?: ProInfoCardData | null;
  currentRole?: Role;
  onCloseMobile?: () => void;
}

const SIDEBAR_ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  LayoutDashboard,
  FileSpreadsheet,
  ShieldCheck,
  Users,
  GraduationCap,
  BookOpen,
  Smartphone,
  RefreshCw,
  Radio,
  History,
  ShieldAlert,
  UserPlus,
  UserCog,
  Settings,
  CalendarCheck,
  CalendarDays,
  QrCode,
  ScanFace,
  Activity,
  Sparkles,
};

const SECTION_ORDER = [
  'DASHBOARD',
  'ROSTER',
  'DEVICES',
  'SESSIONS',
  'SECURITY',
  'ONBOARDING',
  'ADMIN',
];

interface NavItemButtonProps {
  entry: NavEntry;
  isActive: boolean;
  onClick: () => void;
}

const NavItemButton: React.FC<NavItemButtonProps> = ({ entry, isActive, onClick }) => {
  const badgeCount = useBadge(entry.badgeId);
  const IconComp = SIDEBAR_ICON_MAP[entry.icon] || Activity;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all group ${
        isActive
          ? 'bg-[#1e1f24] text-white font-semibold border border-[#2a2b31] shadow-sm'
          : 'text-[#9ca3af] hover:text-white hover:bg-[#1e1f24]/50'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
            isActive
              ? 'bg-gradient-to-tr from-[#6366f1] to-[#8b5cf6] text-white shadow-sm'
              : 'bg-[#1e1f24] text-[#9ca3af] group-hover:text-white'
          }`}
        >
          <IconComp className="w-3.5 h-3.5" />
        </div>
        <span className="truncate text-left">{entry.label}</span>
      </div>

      {badgeCount > 0 && (
        <span
          className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shrink-0 font-mono"
          aria-label={`${badgeCount} notifications`}
        >
          {badgeCount}
        </span>
      )}
    </button>
  );
};

export const SecondarySidebar: React.FC<SecondarySidebarProps> = ({
  activeId,
  onSelect,
  isCollapsed,
  currentRole = 'admin',
  onCloseMobile,
}) => {
  // 100% Registry-driven navigation filtered by role
  const registeredNav = navRegistry.all(currentRole);

  const sectionsWithItems = useMemo(() => {
    const grouped: Record<string, NavEntry[]> = {};
    for (const item of registeredNav) {
      const sec = (item.section || 'DASHBOARD').toUpperCase();
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push(item);
    }

    // Sort items within each section ascending by order (10..90)
    for (const sec in grouped) {
      grouped[sec].sort((a, b) => a.order - b.order);
    }

    // Return ordered sections
    const result: { section: string; items: NavEntry[] }[] = [];
    for (const sec of SECTION_ORDER) {
      if (grouped[sec] && grouped[sec].length > 0) {
        result.push({ section: sec, items: grouped[sec] });
      }
    }
    // Any remaining sections not in SECTION_ORDER
    for (const sec in grouped) {
      if (!SECTION_ORDER.includes(sec) && grouped[sec].length > 0) {
        result.push({ section: sec, items: grouped[sec] });
      }
    }
    return result;
  }, [registeredNav]);

  return (
    <aside
      aria-label="Secondary Navigation Sidebar"
      className={`h-screen sticky top-0 bg-[#17181c] border-r border-[#2a2b31] flex flex-col justify-between transition-all duration-300 ease-in-out z-20 ${
        isCollapsed
          ? 'w-0 min-w-0 max-w-0 opacity-0 overflow-hidden pointer-events-none border-none p-0'
          : 'w-[240px] min-w-[240px] max-w-[240px] opacity-100 p-4'
      }`}
    >
      <div className="flex flex-col gap-4 overflow-y-auto no-scrollbar flex-1 pb-4">
        {/* Header */}
        <div className="flex items-center justify-between px-2 pt-1 pb-1 border-b border-[#2a2b31]/40">
          <div>
            <span className="text-[10px] font-bold tracking-widest text-[#9ca3af] uppercase font-mono">
              PORTAL NAV
            </span>
            <h2 className="text-sm font-bold text-white tracking-tight mt-0.5">
              Attendance ERP
            </h2>
          </div>
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        </div>

        {/* Sections and Items List */}
        <nav className="flex flex-col gap-4 w-full" aria-label="Portal navigation sections">
          {sectionsWithItems.map(({ section, items }) => (
            <div key={section} className="space-y-1.5">
              <div className="px-2">
                <span className="text-[10px] font-bold tracking-wider text-[#9ca3af]/70 uppercase">
                  {section}
                </span>
              </div>
              <div className="space-y-1">
                {items.map((entry) => (
                  <NavItemButton
                    key={entry.id}
                    entry={entry}
                    isActive={activeId === entry.id || activeId === entry.path}
                    onClick={() => {
                      onSelect(entry.id);
                      onCloseMobile?.();
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Institutional Footer */}
      <div className="pt-3 border-t border-[#2a2b31]/60 flex items-center justify-between text-[11px] text-[#9ca3af] px-1">
        <span className="font-mono text-[10px] text-slate-500">SNIST R25</span>
        <span className="text-emerald-400 font-medium text-[10px]">● Online</span>
      </div>
    </aside>
  );
};

export default SecondarySidebar;
