import React from 'react';
import {
  Activity,
  Users,
  GraduationCap,
  CalendarDays,
  QrCode,
  ScanFace,
  Smartphone,
  ShieldAlert,
  FileSpreadsheet,
  Settings,
  Sparkles,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { SecondarySidebarItem, ProInfoCardData } from '../../services/mockApi';

interface SecondarySidebarProps {
  items: SecondarySidebarItem[];
  activeId: string;
  onSelect: (id: string) => void;
  isCollapsed: boolean;
  proCard: ProInfoCardData | null;
  onCloseMobile?: () => void;
}

const SIDEBAR_ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Activity,
  Users,
  GraduationCap,
  CalendarDays,
  QrCode,
  ScanFace,
  Smartphone,
  ShieldAlert,
  FileSpreadsheet,
  Settings,
};

export const SecondarySidebar: React.FC<SecondarySidebarProps> = ({
  items,
  activeId,
  onSelect,
  isCollapsed,
  proCard,
  onCloseMobile,
}) => {
  return (
    <aside
      aria-label="Secondary Navigation Sidebar"
      className={`h-screen sticky top-0 bg-[#17181c] border-r border-[#2a2b31] flex flex-col justify-between transition-all duration-300 ease-in-out z-20 ${
        isCollapsed
          ? 'w-0 min-w-0 max-w-0 opacity-0 overflow-hidden pointer-events-none border-none p-0'
          : 'w-[240px] min-w-[240px] max-w-[240px] opacity-100 p-4'
      }`}
    >
      <div className="flex flex-col gap-5 overflow-y-auto no-scrollbar">
        {/* Section Header */}
        <div className="flex items-center justify-between px-2 pt-1">
          <div>
            <span className="text-[11px] font-bold tracking-widest text-[#9ca3af] uppercase">
              DASHBOARD
            </span>
            <h2 className="text-sm font-bold text-white tracking-tight mt-0.5">
              Attendance Portal
            </h2>
          </div>
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        </div>

        {/* Navigation Items List */}
        <nav className="flex flex-col gap-1 w-full" aria-label="Dashboard views">
          {items.map((item) => {
            const IconComp = SIDEBAR_ICON_MAP[item.iconName] || Activity;
            const isActive = activeId === item.id;

            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelect(item.id);
                  onCloseMobile?.();
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
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
                  <span className="truncate">{item.label}</span>
                </div>

                {/* Optional Badge */}
                {item.badge && (
                  <Badge
                    variant={
                      item.badgeVariant === 'success'
                        ? 'success'
                        : item.badgeVariant === 'purple'
                        ? 'accent'
                        : item.badgeVariant === 'warning'
                        ? 'hero'
                        : 'default'
                    }
                    className="text-[10px] px-1.5 py-0 tracking-tight shrink-0"
                  >
                    {item.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom: "Upgrade to Pro"-Style Info Card */}
      {proCard && (
        <div className="pt-4 border-t border-[#2a2b31] mt-auto">
          <div className="relative overflow-hidden rounded-[12px] border border-[#2a2b31] bg-[#1e1f24] p-3.5 shadow-sm group">
            {/* Subtle violet background glow */}
            <div className="absolute -top-12 -right-12 w-24 h-24 bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 rounded-full blur-xl pointer-events-none" />

            <div className="flex items-start justify-between gap-2 mb-2 relative z-10">
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center text-white shadow-sm">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-xs font-bold text-white tracking-tight">
                  {proCard.title}
                </h3>
              </div>
              <Badge variant="accent" className="text-[9px] px-1.5 py-0 font-bold">
                {proCard.badge}
              </Badge>
            </div>

            <p className="text-[11px] leading-relaxed text-[#9ca3af] mb-3 relative z-10">
              {proCard.description}
            </p>

            <button
              onClick={() => onSelect('system-setup')}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] hover:from-[#5558e6] hover:to-[#7c4deb] text-white text-[11px] font-bold shadow-md shadow-indigo-500/20 active:scale-[0.98] transition-all"
            >
              <ShieldCheck className="w-3 h-3 text-indigo-100" />
              <span>{proCard.buttonLabel}</span>
              <ChevronRight className="w-3 h-3 opacity-80" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
