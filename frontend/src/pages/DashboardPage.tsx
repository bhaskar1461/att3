import React from 'react';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { RoleGate } from '../core/components/RoleGate';
import { useAuth } from '../context/AuthContext';
import { Role } from '../core/types';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  let currentRole: Role | undefined;
  if (user?.role) {
    const lower = user.role.toLowerCase();
    if (lower.includes('admin')) currentRole = 'admin';
    else if (lower.includes('teacher') || lower.includes('faculty')) currentRole = 'teacher';
    else currentRole = 'student';
  }

  return (
    <RoleGate roles={['admin', 'teacher']} currentRole={currentRole}>
      <DashboardShell />
    </RoleGate>
  );
};

export default DashboardPage;

