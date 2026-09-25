import React from 'react';
import { Role, WidgetProps } from '../types';
import { widgetRegistry } from '../registries';

export interface DashboardGridProps {
  zone: 'kpi' | 'main' | 'side';
  role?: Role;
  range?: 'today' | 'week' | 'month';
  className?: string;
}

const COL_SPAN_MAP: Record<number, string> = {
  1: 'col-span-12 sm:col-span-6 md:col-span-1',
  2: 'col-span-12 sm:col-span-6 md:col-span-2',
  3: 'col-span-12 sm:col-span-6 lg:col-span-3',
  4: 'col-span-12 sm:col-span-6 lg:col-span-4',
  5: 'col-span-12 lg:col-span-5',
  6: 'col-span-12 lg:col-span-6',
  7: 'col-span-12 lg:col-span-7',
  8: 'col-span-12 lg:col-span-8',
  12: 'col-span-12',
};

const ROW_SPAN_MAP: Record<number, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
  3: 'row-span-3',
  4: 'row-span-4',
};

export const DashboardGrid: React.FC<DashboardGridProps> = ({
  zone,
  role = 'admin',
  range = 'today',
  className = '',
}) => {
  const widgets = widgetRegistry.forZone(zone, role);

  // Sibling zone auto-expansion check (Tweak 2)
  const siblingZone = zone === 'main' ? 'side' : zone === 'side' ? 'main' : null;
  const siblingWidgets = siblingZone ? widgetRegistry.forZone(siblingZone, role) : [];
  const hasSibling = siblingWidgets.length > 0;

  if (widgets.length === 0) {
    // If main is empty this phase but side has hero, render empty container to reserve Phase 6 space
    if (zone === 'main' && hasSibling) {
      return (
        <div
          className={`col-span-12 xl:col-span-8 order-2 xl:order-1 min-h-[360px] rounded-[12px] border border-dashed border-[#2a2b31]/60 flex items-center justify-center p-8 text-center text-[#9ca3af]/60 text-xs ${className}`}
        >
          <span>Attendance Analytics (Phase 6 Charts)</span>
        </div>
      );
    }
    return null;
  }

  // Zone 'kpi' renders standard 12-col responsive grid
  if (zone === 'kpi') {
    return (
      <div className={`grid grid-cols-12 gap-4 lg:gap-6 ${className}`}>
        {widgets.map((widget) => {
          const WidgetComponent = widget.component;
          const colClass = COL_SPAN_MAP[widget.grid.cols] || 'col-span-12';
          const rowClass = ROW_SPAN_MAP[widget.grid.rows] || '';

          return (
            <div key={widget.id} className={`${colClass} ${rowClass} transition-all`}>
              <WidgetComponent range={range} />
            </div>
          );
        })}
      </div>
    );
  }

  // Zone 'main' or 'side'
  const isMain = zone === 'main';

  // If sibling has zero visible widgets, expand to col-span-12
  const colSpanClass = !hasSibling
    ? 'col-span-12'
    : isMain
    ? 'col-span-12 xl:col-span-8 order-2 xl:order-1'
    : 'col-span-12 xl:col-span-4 order-1 xl:order-2';

  return (
    <div className={`${colSpanClass} grid grid-cols-12 gap-6 ${className}`}>
      {widgets.map((widget) => {
        const WidgetComponent = widget.component;
        const colClass = COL_SPAN_MAP[widget.grid.cols] || 'col-span-12';
        const rowClass = ROW_SPAN_MAP[widget.grid.rows] || '';
        return (
          <div key={widget.id} className={`${colClass} ${rowClass} transition-all empty:hidden`}>
            <WidgetComponent range={range} />
          </div>
        );
      })}
    </div>
  );
};
