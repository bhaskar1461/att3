import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'excel-grid',
  roles: ['SUPER_ADMIN', 'TEACHER', 'admin', 'teacher'],
  permissions: ['roster.write'],
};
