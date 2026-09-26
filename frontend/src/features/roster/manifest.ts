import React from 'react';
import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'roster',
  nav: [
    {
      id: 'roster-students',
      label: 'Students',
      icon: 'Users',
      path: '/roster/students',
      section: 'ROSTER',
      roles: ['admin', 'teacher'],
      order: 10,
    },
    {
      id: 'roster-teachers',
      label: 'Teachers',
      icon: 'GraduationCap',
      path: '/roster/teachers',
      section: 'ROSTER',
      roles: ['admin'],
      order: 20,
    },
    {
      id: 'roster-classes',
      label: 'Classes',
      icon: 'BookOpen',
      path: '/roster/classes',
      section: 'ROSTER',
      roles: ['admin', 'teacher'],
      order: 30,
    },
  ],
  routes: [
    {
      path: '/roster/students',
      title: 'Student Directory',
      roles: ['admin', 'teacher'],
      component: React.lazy(() => import('./StudentsPage')),
    },
    {
      path: '/roster/teachers',
      title: 'Faculty Roster',
      roles: ['admin'],
      component: React.lazy(() => import('./TeachersPage')),
    },
    {
      path: '/roster/classes',
      title: 'Class Allocations',
      roles: ['admin', 'teacher'],
      component: React.lazy(() => import('./ClassesPage')),
    },
  ],
  permissions: ['roster.read', 'roster.write'],
};

export default manifest;
