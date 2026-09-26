import React from 'react';
import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'attendance',
  routes: [
    {
      path: '/attendance/day',
      title: 'Day Register',
      roles: ['admin', 'teacher'],
      component: React.lazy(() => import('./DayRegisterPage')),
    },
    {
      path: '/attendance/today',
      title: "Today's Attendance Register",
      roles: ['admin', 'teacher'],
      component: React.lazy(() => import('./TodayRegisterPage')),
    },
  ],
  permissions: ['reports.read'],
};

export default manifest;
