import { Role, Permission } from './types';

const ALL_PERMISSIONS: Permission[] = [
  'roster.read',
  'roster.write',
  'reports.read',
  'reports.export',
  'compliance.read',
  'security.read',
  'security.act',
  'devices.read',
  'devices.act',
  'onboarding.act',
  'sessions.broadcast',
  'users.manage',
];

const MATRIX: Record<Role, Permission[]> = {
  admin: ALL_PERMISSIONS,
  teacher: [
    'roster.read',
    'reports.read',
    'reports.export',
    'sessions.broadcast',
    'security.read',
  ],
  student: [],
};

export const can = (role: Role, p: Permission): boolean => {
  return MATRIX[role]?.includes(p) ?? false;
};
