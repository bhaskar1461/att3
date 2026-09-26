import React from 'react';
import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'compliance',
  nav: [
    {
      id: 'compliance-bands',
      label: 'Compliance',
      icon: 'ShieldCheck',
      path: '/compliance',
      section: 'DASHBOARD',
      roles: ['admin'],
      order: 30,
    },
  ],
  routes: [
    {
      path: '/compliance',
      title: 'JNTUH R25 Compliance',
      roles: ['admin'],
      component: React.lazy(() => import('./ComplianceBandsPage')),
    },
  ],
  permissions: ['compliance.read'],
};

export default manifest;
