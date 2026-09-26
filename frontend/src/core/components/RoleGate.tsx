import React from 'react';
import { Role } from '../types';
import { ForbiddenPage } from './ForbiddenPage';

export interface RoleGateProps {
  roles: Role[];
  currentRole?: Role;
  children: React.ReactNode;
  fallbackPath?: string;
}

export const RoleGate: React.FC<RoleGateProps> = ({
  roles,
  currentRole,
  children,
}) => {
  // Resolve active role: prop > localStorage (stored by auth) > 'student'
  let activeRole: Role = currentRole || 'student';
  if (!currentRole && typeof localStorage !== 'undefined') {
    const rawRole = localStorage.getItem('role') || '';
    const lower = rawRole.toLowerCase();
    if (lower.includes('admin')) {
      activeRole = 'admin';
    } else if (lower.includes('teacher') || lower.includes('faculty')) {
      activeRole = 'teacher';
    } else {
      activeRole = 'student';
    }
  }

  if (!roles.includes(activeRole)) {
    return (
      <ForbiddenPage
        explanation={`This resource requires one of [${roles.join(', ')}], but your current active session role is '${activeRole}'.`}
      />
    );
  }

  return <>{children}</>;
};
