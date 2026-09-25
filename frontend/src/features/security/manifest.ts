import { FeatureManifest } from '../../core/types';
import { VerificationQueueDonut } from './widgets/VerificationQueueDonut';
import { QueueTable } from './components/QueueTable';

export const manifest: FeatureManifest = {
  name: 'security',
  widgets: [
    {
      id: 'security.verification_donut',
      zone: 'main',
      order: 10,
      roles: ['admin', 'teacher'],
      grid: { cols: 5, rows: 1 },
      component: VerificationQueueDonut,
    },
    {
      id: 'security.queue_table',
      zone: 'main',
      order: 20,
      roles: ['admin', 'teacher'],
      grid: { cols: 12, rows: 1 },
      component: QueueTable,
    },
  ],
  permissions: ['security.read', 'security.act'],
};

export default manifest;
