import React from 'react';
import type { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'auth',
  routes: [
    {
      path: '/login',
      title: 'Sign In',
      roles: ['student', 'teacher', 'admin'],
      component: React.lazy(() => import('./LoginPage').then((m) => ({ default: m.LoginPage }))),
    },
  ],
};

export default manifest;
