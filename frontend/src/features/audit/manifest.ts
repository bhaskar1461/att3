import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'audit',
  roles: ['SUPER_ADMIN', 'admin'],
  permissions: ['security.read'],
};
