import React from 'react';
import { FeatureManifest } from '../../core/types';
import { SampleWidget } from './SampleWidget';

export const manifest: FeatureManifest = {
  name: 'sample',
  routes: [
    {
      path: '/sample',
      title: 'Sample Extensibility Page',
      roles: ['admin', 'teacher'],
      component: React.lazy(() => import('./SamplePage')),
    },
  ],
  widgets: [
    {
      id: 'sample-kpi',
      roles: ['admin', 'teacher'],
      zone: 'kpi',
      order: 100,
      grid: { cols: 3, rows: 1 },
      component: SampleWidget,
    },
  ],
  permissions: ['roster.read'],
};

export default manifest;
