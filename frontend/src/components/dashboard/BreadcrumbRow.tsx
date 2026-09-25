import React from 'react';
import { Home, ChevronRight, Clock, ShieldCheck, RefreshCw } from 'lucide-react';
import { BreadcrumbData } from '../../services/mockApi';

interface BreadcrumbRowProps {
  breadcrumb: BreadcrumbData;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const BreadcrumbRow: React.FC<BreadcrumbRowProps> = ({
  breadcrumb,
  onRefresh,
  isRefreshing = false,
}) => {
  return (
    <div className="w-full flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-4 px-4 sm:px-6 border-b border-[#2a2b31]/60 bg-[#141416]/50">
      {/* Breadcrumb Trail */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
        <span className="flex items-center gap-1 text-[#9ca3af] hover:text-white transition-colors cursor-pointer">
          <Home className="w-3.5 h-3.5" />
          <span>{breadcrumb.rootLabel}</span>
        </span>
        <ChevronRight className="w-3 h-3 text-[#9ca3af]/60" />
        <span className="text-[#9ca3af] hover:text-white transition-colors cursor-pointer">
          {breadcrumb.sectionLabel}
        </span>
        <ChevronRight className="w-3 h-3 text-[#9ca3af]/60" />
        <span className="text-white font-semibold tracking-tight">
          {breadcrumb.currentLabel}
        </span>
      </nav>

      {/* Right Meta Pills / Actions */}
      <div className="flex items-center gap-2 text-xs">
        {/* Server Authoritative Time IST Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1e1f24] border border-[#2a2b31] text-[#9ca3af]">
          <Clock className="w-3 h-3 text-indigo-400" />
          <span className="text-[11px] font-mono font-medium text-slate-300">
            IST Authority
          </span>
        </div>

        {/* JNTUH R25 Rule Badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1e1f24] border border-[#2a2b31] text-[#9ca3af]">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          <span className="text-[11px] font-medium text-slate-300">
            R25 Compliant
          </span>
        </div>

        {/* Quick Refresh */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            aria-label="Refresh dashboard data"
            className="p-1.5 rounded-md bg-[#1e1f24] hover:bg-[#2a2b31] border border-[#2a2b31] text-[#9ca3af] hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
};
