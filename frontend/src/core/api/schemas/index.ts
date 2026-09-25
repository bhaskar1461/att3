/**
 * Central API Schemas Registry
 * 
 * DATE POLICY:
 * All date and timestamp fields across all schemas are strictly preserved as string representations
 * (ISO 8601 or server IST format 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm:ss') via z.string().
 * This guarantees server-authoritative time enforcement (Rule 5) without client-side timezone drift.
 */

import * as auth from './auth';
import * as roster from './roster';
import * as attendance from './attendance';
import * as sessions from './sessions';
import * as reports from './reports';
import * as devices from './devices';
import * as onboarding from './onboarding';
import * as security from './security';
import * as sync from './sync';
import * as aggregates from './aggregates';

export * from './auth';
export * from './roster';
export * from './attendance';
export * from './sessions';
export * from './reports';
export * from './devices';
export * from './onboarding';
export * from './security';
export * from './sync';
export * from './aggregates';

export const s = {
  ...auth,
  ...roster,
  ...attendance,
  ...sessions,
  ...reports,
  ...devices,
  ...onboarding,
  ...security,
  ...sync,
  ...aggregates,
};

export default s;
