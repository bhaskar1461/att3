import { Role, LegacyRole, Permission, DeclaredPermission } from './types';

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

export const normalizeRole = (role: Role): LegacyRole => {
  if (role === 'SUPER_ADMIN') return 'admin';
  if (role === 'TEACHER') return 'teacher';
  if (role === 'STUDENT') return 'student';
  return role as LegacyRole;
};

const MATRIX: Record<LegacyRole, Permission[]> = {
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
        const norm = normalizeRole(r);
        if (!MATRIX[norm]) MATRIX[norm] = [];
        if (!MATRIX[norm].includes(key)) {
          MATRIX[norm].push(key);
        }
      }
    }
  }
};

export const can = (role: Role, p: Permission): boolean => {
  const norm = normalizeRole(role);
  return MATRIX[norm]?.includes(p) ?? false;
};
