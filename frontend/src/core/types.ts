import React from 'react';

export type CanonicalRole = 'SUPER_ADMIN' | 'TEACHER' | 'STUDENT';
export type LegacyRole = 'admin' | 'teacher' | 'student';
export type Role = LegacyRole | CanonicalRole;

export type Permission =
  | 'roster.read'
  | 'roster.write'
  | 'reports.read'
  | 'reports.export'
  | 'compliance.read'
  | 'security.read'
  | 'security.act'
  | 'devices.read'
  | 'devices.act'
  | 'onboarding.act'
  | 'sessions.broadcast'
  | 'users.manage'
  | (string & {});

export interface DeclaredPermission {
  key: string;
  roles: Role[];
}

export interface NavEntry {
  id: string;
  label: string;
  icon: string;
  path: string;
  section: string;
  roles: Role[];
  order: number;
  badge?: () => number | null;
  badgeId?: string;
}

export interface RouteEntry {
  path: string;
  title: string;
  roles: Role[];
  component: React.LazyExoticComponent<React.ComponentType<any>>;
}

export interface WidgetProps {
  range: 'today' | 'week' | 'month';
}

export interface WidgetEntry {
  id: string;
  roles: Role[];
  zone: 'kpi' | 'main' | 'side';
  order: number;
  grid: { cols: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 12; rows: number };
  component: React.ComponentType<WidgetProps>;
}

export interface FeatureManifest {
  name: string;
  roles?: Role[];
  nav?: NavEntry[];
  routes?: RouteEntry[];
  widgets?: WidgetEntry[];
  permissions?: Array<DeclaredPermission | Permission>;
}
