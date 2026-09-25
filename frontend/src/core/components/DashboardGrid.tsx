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
  6: 'col-span-12 lg:col-span-6',
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

  if (widgets.length === 0) {
    return null;
  }

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
};
