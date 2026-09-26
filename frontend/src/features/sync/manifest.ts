import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'sync',
  roles: ['SUPER_ADMIN', 'TEACHER', 'admin', 'teacher'],
  permissions: ['reports.export'],
};
