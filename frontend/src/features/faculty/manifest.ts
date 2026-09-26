import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'faculty',
  roles: ['SUPER_ADMIN', 'admin'],
  permissions: ['users.manage'],
};
