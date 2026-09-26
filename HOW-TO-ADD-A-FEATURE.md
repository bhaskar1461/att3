# Developer Guide: How to Add a Feature to SNIST ERP

This guide defines the standardized, zero-core-modification protocol for adding new features to the SNIST Attendance & ERP Dashboard. Using the **Leave Requests** (`src/features/leave/`) feature as our canonical worked example, this document demonstrates how an entire vertical slice—including navigation, routes, widgets, permissions, schemas, and live badges—can be added or deleted with zero manual edits to core infrastructure.

---

## 1. Feature Folder Skeleton Template

Every feature lives under `src/features/<feature-name>/` as a self-contained, modular unit:

```text
src/features/<feature-name>/
├── manifest.ts             # Primary feature declaration (nav, routes, widgets, permissions)
├── schemas.ts              # Zod validation schemas & TypeScript types
├── api.ts                  # Typed API clients or mock adapters (annotated with TODO-REAL)
├── hooks.ts                # React Query hooks, invalidation map & badge publishing
├── <Feature>Page.tsx       # Primary full-page view (supports ?open=<id> deep link)
└── widgets/                # Dashboard overview widgets
    └── <Feature>Widget.tsx # Self-contained WidgetShell consumer
```

---

## 2. Manifest Field Reference

The feature manifest (`manifest.ts`) is auto-discovered at runtime by Vite (`import.meta.glob('../features/*/manifest.ts', { eager: true })`).

```typescript
import React from 'react';
import { FeatureManifest } from '../../core/types';
import { LeaveWidget } from './widgets/LeaveWidget';

export const manifest: FeatureManifest = {
  // Unique feature namespace
  name: 'leave',

  // Declarative role permissions aggregated at boot
  permissions: [
    { key: 'leave.act', roles: ['admin'] },
  ],

  // Secondary sidebar navigation entries
  nav: [
    {
      id: 'leave-requests',
      label: 'Leave Requests',
      icon: 'CalendarDays',
      path: '/leave',
      section: 'LEAVE',            // Section header in sidebar (created dynamically)
      roles: ['admin'],
      order: 1,
      badgeId: 'leave-open-count', // Bound to reactive badge store
    },
  ],

  // Registered application routes
  routes: [
    {
      path: '/leave',
      title: 'Leave Requests',
      roles: ['admin'],
      component: React.lazy(() => import('./LeaveRequestsPage')),
    },
  ],

  // Dashboard Overview widgets
  widgets: [
    {
      id: 'leave-requests-widget',
      roles: ['admin'],
      zone: 'side',                 // 'kpi' | 'main' | 'side'
      order: 5,
      grid: { cols: 12, rows: 1 },  // Zone-relative column span
      component: LeaveWidget,
    },
  ],
};

export default manifest;
```

---

## 3. Dynamic Permission Declaration

Do **not** hand-edit `src/core/roles.ts`. Feature permissions are declared directly within `manifest.permissions`.
During initialization, `initializeFeatures()` in `src/core/features.ts` automatically registers these permissions into the role matrix:

```typescript
// In your feature manifest:
permissions: [
  { key: 'leave.act', roles: ['admin'] },
  { key: 'leave.view', roles: ['admin', 'teacher'] },
]

// In your components/pages:
import { can } from '../../core/roles';
import { useAuth } from '../auth/hooks';
import { normalizeRole } from '../../core/auth/AuthProvider';

const { user } = useAuth();
const role = normalizeRole(user?.role || 'student');
const canAct = can(role, 'leave.act');
```

---

## 4. Schema, Endpoint & Hook Conventions

1. **Schemas (`schemas.ts`)**: Define strict Zod validation schemas for all domain entities and mutation payloads:
   ```typescript
   export const LeaveRequestSchema = z.object({
     id: z.string(),
     student_name: z.string(),
     roll_number: z.string(),
     status: z.enum(['pending', 'approved', 'rejected']),
   });
   export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;
   ```

2. **Endpoints / API (`api.ts`)**: Encapsulate network calls. If backend FastAPI endpoints are pending, mark with `// TODO-REAL`:
   ```typescript
   // TODO-REAL: Replace with apiClient.get('/api/v1/leave/requests')
   export const leaveApi = {
     fetchLeaveRequests: async (): Promise<LeaveRequest[]> => { ... },
     actOnLeaveRequest: async (payload: LeaveAction): Promise<LeaveRequest> => { ... },
   };
   ```

3. **Hooks (`hooks.ts`)**: Structure queries and mutations with typed keys and automatic cache invalidation:
   ```typescript
   export const leaveKeys = {
     all: ['leave'] as const,
     list: () => [...leaveKeys.all, 'list'] as const,
   };
   ```

---

## 5. Cache Invalidation Map

Always coordinate mutation invalidations so all dependent UI surfaces update atomically without manual refresh:

| Mutation | Invalidated Query Keys | Impacted UI Surfaces |
| :--- | :--- | :--- |
| `useActOnLeaveMutation` | `leaveKeys.all` | `LeaveRequestsPage` table, `LeaveWidget` count, Sidebar unread badge |

```typescript
export function useActOnLeaveMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: leaveApi.actOnLeaveRequest,
    onSuccess: () => {
      // Invalidates both list queries and count aggregations
      queryClient.invalidateQueries({ queryKey: leaveKeys.all });
    },
  });
}
```

---

## 6. Live Badge Publishing

Badges in the sidebar and topbar use the reactive `core/badges.ts` store (`useSyncExternalStore`):

```typescript
import { useEffect } from 'react';
import { setBadge } from '../../core/badges';

export function useLeaveRequestsQuery() {
  const query = useQuery({ ... });

  useEffect(() => {
    if (query.data) {
      const openCount = query.data.filter(r => r.status === 'pending').length;
      setBadge('leave-open-count', openCount);
    }
  }, [query.data]);

  return query;
}
```

The sidebar entry binds to `badgeId: 'leave-open-count'` and reacts instantly with zero re-render overhead to unconcerned components.

---

## 7. WidgetShell Usage

Every dashboard widget must be wrapped in `WidgetShell`. This guarantees standardized loading skeletons, error boundaries with retry buttons, and helpful empty states:

```tsx
<WidgetShell
  query={query}
  skeleton={<SkeletonCard className="p-5 min-h-[160px]" lines={3} />}
  isEmpty={(data) => !data || data.length === 0}
  empty={
    <ChartCard title="Leave Requests" subtitle="Student leave management">
      <div className="py-6 text-center text-xs text-[#9ca3af]">No active leave requests</div>
    </ChartCard>
  }
>
  {(leaves) => (
    <ChartCard title="Leave Requests" subtitle="Active notifications">
      {/* Real widget content */}
    </ChartCard>
  )}
</WidgetShell>
```

---

## 8. Zone-Relative `grid.cols` Reminder

When configuring `widgets[].grid` in `manifest.ts`, remember that column spans are **zone-relative**:

- **Side Zone (`zone: 'side'`)**:
  - The side container is 4 columns wide on xl screens (`col-span-12 xl:col-span-4`).
  - Internal grid is 12 columns. Always specify `grid: { cols: 12, rows: 1 }` for full-width side cards.
- **Main Zone (`zone: 'main'`)**:
  - The main container is 8 columns wide on xl screens (`col-span-12 xl:col-span-8`).
  - Use `cols: 6` for side-by-side cards (e.g. Trends & Heatmap) or `cols: 12` for full-width operational tables.
- **KPI Zone (`zone: 'kpi'`)**:
  - Standard KPI row spans 12 columns total (typically 1 col per metric card in a 5-column responsive flex/grid).

---

## 9. `?open=<id>` Deep-Link Pattern

Full-page feature views must inspect URL query parameters on mount to highlight, expand, or auto-open target entities linked from topbar search or alerts:

```tsx
export const LeaveRequestsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const openId = searchParams.get('open');
  const [highlightedId, setHighlightedId] = useState<string | null>(openId);

  useEffect(() => {
    if (openId) {
      setHighlightedId(openId);
      // Auto-fade highlight after 5 seconds
      const timer = setTimeout(() => setHighlightedId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [openId]);

  return (
    <tr className={highlightedId === req.id ? 'bg-indigo-950/40 ring-1 ring-indigo-500' : ''}>
      ...
    </tr>
  );
};
```

---

## 10. The 10-Point New-Feature Checklist

Before merging or committing any new feature slice, verify every checkbox:

- [ ] **1. Manifest Declared**: `manifest.ts` exports `FeatureManifest` with `name`, `roles`, `nav`, `routes`, `widgets`.
- [ ] **2. Zero Core Edits**: No changes made to `App.tsx`, `DashboardShell.tsx`, `Sidebar.tsx`, or `features.ts`.
- [ ] **3. Strict Identity**: Uses canonical SAP ID / Roll Number as immutable primary institutional keys.
- [ ] **4. Server Time**: All timestamps and date filters use IST (`Asia/Kolkata`) server-authoritative time.
- [ ] **5. Zod Validated**: Schemas in `schemas.ts` parse all incoming payloads and mock structures.
- [ ] **6. Invalidation Mapped**: Mutations trigger explicit cache invalidation across all related query keys.
- [ ] **7. WidgetShell Guarded**: Widgets implement skeleton loading, retryable error state, and non-blank empty state.
- [ ] **8. Reactive Badges**: Queue counts published via `setBadge(badgeId, count)` to dynamic store.
- [ ] **9. Deep Link Ready**: Page accepts `?open=<id>` and visually highlights target entity.
- [ ] **10. Zero Residue Deletion**: Deleting `src/features/<feature>/` returns `git diff` to 100% clean state with zero compile errors.
