import React from 'react';
import { WidgetProps } from '../../core/types';
import { StatCard } from '../../components/dashboard/StatCard';

export const SampleWidget: React.FC<WidgetProps> = ({ range }) => {
  return (
    <StatCard
      title={`Live Sample Rate (${range})`}
      value="94.8%"
      delta={3.2}
      footer="Self-registered via sample/manifest.ts"
    />
  );
};

export default SampleWidget;
