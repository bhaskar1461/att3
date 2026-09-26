import React from 'react';
import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'admin',
  nav: [
    {
      id: 'admin-users',
      label: 'Users',
      icon: 'UserCog',
      path: '/admin/users',
      section: 'ADMIN',
      roles: ['admin'],
      order: 10,
    },
    {
      id: 'admin-settings',
      label: 'Settings',
      icon: 'Settings',
      path: '/admin/settings',
      section: 'ADMIN',
      roles: ['admin'],
      order: 20,
    },
  ],
  routes: [
    {
      path: '/admin/users',
      title: 'Users',
      roles: ['admin'],
      component: React.lazy(() => import('./UsersManagementPage')),
    },
    {
      path: '/admin/settings',
      title: 'Settings',
      roles: ['admin'],
      component: React.lazy(() => import('./SettingsPage')),
    },
  ],
  permissions: ['users.manage'],
};

export default manifest;
