import { Role, Permission, DeclaredPermission } from './types';

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
  admin: [...ALL_PERMISSIONS],
  teacher: [
    'roster.read',
    'reports.read',
    'reports.export',
    'sessions.broadcast',
    'security.read',
  ],
  student: [],
};

export const registerPermissions = (declared: Array<DeclaredPermission | Permission>): void => {
  for (const item of declared) {
    if (typeof item === 'string') {
      if (!MATRIX.admin.includes(item)) MATRIX.admin.push(item);
    } else if (item && typeof item === 'object') {
      const { key, roles } = item;
      for (const r of roles) {
        if (!MATRIX[r]) MATRIX[r] = [];
        if (!MATRIX[r].includes(key)) {
          MATRIX[r].push(key);
        }
      }
    }
  }
};

export const can = (role: Role, p: Permission): boolean => {
  return MATRIX[role]?.includes(p) ?? false;
};
