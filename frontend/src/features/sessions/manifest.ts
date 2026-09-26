import React from 'react';
import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'sessions',
  nav: [
    {
      id: 'sessions-live',
      label: 'Live',
      icon: 'Radio',
      path: '/sessions/live',
      section: 'SESSIONS',
      roles: ['admin', 'teacher'],
      order: 10,
    },
    {
      id: 'sessions-history',
      label: 'History',
      icon: 'History',
      path: '/sessions/history',
      section: 'SESSIONS',
      roles: ['admin', 'teacher'],
      order: 20,
    },
  ],
  routes: [
    {
      path: '/sessions/live',
      title: 'Live Sessions',
      roles: ['admin', 'teacher'],
      component: React.lazy(() => import('./LiveSessionsPage')),
    },
    {
      path: '/sessions/history',
      title: 'Session History',
      roles: ['admin', 'teacher'],
      component: React.lazy(() => import('./SessionHistoryPage')),
    },
  ],
  permissions: ['sessions.broadcast'],
};

export default manifest;
