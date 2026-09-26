import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'credentials',
  roles: ['SUPER_ADMIN', 'admin'],
  permissions: ['users.manage'],
};
