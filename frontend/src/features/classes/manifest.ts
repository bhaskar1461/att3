import { FeatureManifest } from '../../core/types';

export const manifest: FeatureManifest = {
  name: 'classes',
  roles: ['SUPER_ADMIN', 'TEACHER', 'admin', 'teacher'],
  permissions: ['roster.read', 'roster.write'],
};
