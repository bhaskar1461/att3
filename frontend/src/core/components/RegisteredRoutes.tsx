import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Role } from '../types';
import { routeRegistry } from '../registries';
import { RoleGate } from './RoleGate';
import { SkeletonCard } from '../../components/dashboard/SkeletonCard';
import { DashboardShell } from '../../components/dashboard/DashboardShell';

export interface RegisteredRoutesProps {
  currentRole?: Role;
}

export const RegisteredRoutes: React.FC<RegisteredRoutesProps> = ({ currentRole = 'admin' }) => {
  const routes = routeRegistry.all();

  return (
    <Routes>
      {routes.map((entry) => {
        const Component = entry.component;
        return (
          <Route
            key={entry.path}
            path={entry.path}
            element={
              <RoleGate roles={entry.roles} currentRole={currentRole}>
                <Suspense fallback={<SkeletonCard className="m-4" height={360} />}>
                  <DashboardShell>
                    <Component />
                  </DashboardShell>
                </Suspense>
              </RoleGate>
            }
          />
        );
      })}
    </Routes>
  );
};

export function renderRegisteredRouteElements(currentRole?: Role) {
  const routes = routeRegistry.all();
  return routes.map((entry) => {
    const Component = entry.component;
    return (
      <Route
        key={entry.path}
        path={entry.path}
        element={
          <RoleGate roles={entry.roles} currentRole={currentRole}>
            <Suspense fallback={<SkeletonCard className="m-4" height={360} />}>
              <DashboardShell>
                <Component />
              </DashboardShell>
            </Suspense>
          </RoleGate>
        }
      />
    );
  });
}
