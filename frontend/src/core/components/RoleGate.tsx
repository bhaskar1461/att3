import React from 'react';
import { Navigate } from 'react-router-dom';
import { Role } from '../types';

export interface RoleGateProps {
  roles: Role[];
  currentRole: Role;
  children: React.ReactNode;
  fallbackPath?: string;
}

export const RoleGate: React.FC<RoleGateProps> = ({
  roles,
  currentRole,
  children,
  fallbackPath = '/overview',
}) => {
  if (!roles.includes(currentRole)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
};
