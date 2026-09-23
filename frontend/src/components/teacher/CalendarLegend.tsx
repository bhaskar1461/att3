/**
 * SNIST ERP - Calendar Status Legend
 * Phase 3: Teacher Calendar UI Implementation
 */

import React from 'react';
import { ExternalLink } from 'lucide-react';

interface CalendarLegendProps {
  onViewAssignments?: () => void;
}

export const CalendarLegend: React.FC<CalendarLegendProps> = ({
  onViewAssignments
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs font-bold text-slate-600">
      {/* Status Badges */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span>Completed</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span>Upcoming</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 motion-safe:animate-pulse" />
          <span>Ongoing / Live</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span>Not Taken</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
          <span>Locked</span>
        </div>
      </div>

      {/* Quick Link */}
      {onViewAssignments && (
        <button
          onClick={onViewAssignments}
          className="text-[#2f53d7] hover:underline flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] rounded-md px-1"
        >
          <span>View Faculty Allotments</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
