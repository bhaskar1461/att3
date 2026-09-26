export interface MockRoute {
  match: RegExp;
  handler: (init?: RequestInit, url?: string) => Promise<unknown>;
  schemaName: string;
}

/**
 * Phase 3 De-escalation:
 * All overview aggregate endpoints (/rollup, /heatmap, /sources, /trends)
 * are now fully backed by live FastAPI backend services.
 * Active mock routes registry is emptied so the client directly requests live endpoints.
 */
export const MOCK_ROUTES: MockRoute[] = [];
