import React from 'react';
import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'devices',
  nav: [
    {
      id: 'devices-bindings',
      label: 'Bindings',
      icon: 'Smartphone',
      path: '/devices/bindings',
      section: 'DEVICES',
      roles: ['admin'],
      order: 10,
    },
    {
      id: 'devices-recoveries',
      label: 'Recoveries',
      icon: 'RefreshCw',
      path: '/devices/recoveries',
      section: 'DEVICES',
      roles: ['admin'],
      order: 20,
      badgeId: 'devices.recoveries',
    },
  ],
  routes: [
    {
      path: '/devices/bindings',
      title: 'Hardware Device Bindings',
      roles: ['admin'],
      component: React.lazy(() => import('./BindingsPage')),
    },
    {
      path: '/devices/recoveries',
      title: 'Device Recovery Queue',
      roles: ['admin'],
      component: React.lazy(() => import('./RecoveriesPage')),
    },
  ],
  permissions: ['devices.read', 'devices.act'],
};

export default manifest;
