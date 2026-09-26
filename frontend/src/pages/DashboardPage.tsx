import React from 'react';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { RoleGate } from '../core/components/RoleGate';

export const DashboardPage: React.FC = () => {
  return (
    <RoleGate roles={['admin', 'teacher']}>
      <DashboardShell />
    </RoleGate>
  );
};

export default DashboardPage;

