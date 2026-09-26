import React from 'react';
import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'onboarding',
  nav: [
    {
      id: 'onboarding-requests',
      label: 'Requests',
      icon: 'UserPlus',
      path: '/onboarding',
      section: 'ONBOARDING',
      roles: ['admin'],
      order: 10,
    },
  ],
  routes: [
    {
      path: '/onboarding',
      title: 'Student Onboarding Requests',
      roles: ['admin'],
      component: React.lazy(() => import('./OnboardingRequestsPage')),
    },
  ],
  permissions: ['onboarding.act'],
};

export default manifest;
