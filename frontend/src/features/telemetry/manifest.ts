import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'telemetry',
  roles: ['SUPER_ADMIN', 'admin'],
  permissions: ['compliance.read'],
};
