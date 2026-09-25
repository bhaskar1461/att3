import React from 'react';

export type Role = 'student' | 'teacher' | 'admin';

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
  | 'users.manage';

export interface NavEntry {
  id: string;
  label: string;
  icon: string;
  path: string;
  section: string;
  roles: Role[];
  order: number;
  badge?: () => number | null;
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
  grid: { cols: 1 | 2 | 3 | 4 | 6 | 8 | 12; rows: number };
  component: React.ComponentType<WidgetProps>;
}

export interface FeatureManifest {
  name: string;
  nav?: NavEntry[];
  routes?: RouteEntry[];
  widgets?: WidgetEntry[];
  permissions?: Permission[];
}
