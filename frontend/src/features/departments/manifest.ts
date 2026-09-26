import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'departments',
  roles: ['SUPER_ADMIN', 'admin'],
  permissions: ['users.manage'],
};
