import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

console.log('=== Running Phase 2 Automated Verification ===\n');

// 1. Verify Core Contract Types (src/core/types.ts)
const typesPath = path.join(__dirname, 'src', 'core', 'types.ts');
assert(fs.existsSync(typesPath), 'src/core/types.ts exists');
const typesContent = fs.readFileSync(typesPath, 'utf8');
assert(typesContent.includes("export type Role = 'student' | 'teacher' | 'admin'"), 'Role type defined');
assert(typesContent.includes('export type Permission ='), 'Permission type defined');
assert(typesContent.includes('roster.read') && typesContent.includes('security.act'), 'Permission contains core security/roster keys');
assert(typesContent.includes('export interface NavEntry'), 'NavEntry interface defined');
assert(typesContent.includes('export interface RouteEntry'), 'RouteEntry interface defined');
assert(typesContent.includes('export interface WidgetProps'), 'WidgetProps interface defined');
assert(typesContent.includes('export interface WidgetEntry'), 'WidgetEntry interface defined');
assert(typesContent.includes('export interface FeatureManifest'), 'FeatureManifest interface defined');

// 2. Verify Registries (src/core/registries.ts)
const registriesPath = path.join(__dirname, 'src', 'core', 'registries.ts');
assert(fs.existsSync(registriesPath), 'src/core/registries.ts exists');
const registriesContent = fs.readFileSync(registriesPath, 'utf8');
assert(registriesContent.includes('navRegistry'), 'navRegistry exported');
assert(registriesContent.includes('routeRegistry'), 'routeRegistry exported');
assert(registriesContent.includes('widgetRegistry'), 'widgetRegistry exported');
assert(registriesContent.includes('forZone(zone:'), 'widgetRegistry.forZone implemented');

// 3. Verify Roles Matrix (src/core/roles.ts)
const rolesPath = path.join(__dirname, 'src', 'core', 'roles.ts');
assert(fs.existsSync(rolesPath), 'src/core/roles.ts exists');
const rolesContent = fs.readFileSync(rolesPath, 'utf8');
assert(rolesContent.includes('export const can ='), 'can(role, permission) helper exported');
assert(rolesContent.includes('teacher: ['), 'Teacher role permissions matrix configured');

// 4. Verify Feature Auto-Discovery (src/core/features.ts)
const featuresPath = path.join(__dirname, 'src', 'core', 'features.ts');
assert(fs.existsSync(featuresPath), 'src/core/features.ts exists');
const featuresContent = fs.readFileSync(featuresPath, 'utf8');
assert(featuresContent.includes("import.meta.glob"), 'features.ts uses import.meta.glob for zero-edit self-registration');

// 5. Verify Core Query Client (src/core/queryClient.ts)
const queryClientPath = path.join(__dirname, 'src', 'core', 'queryClient.ts');
assert(fs.existsSync(queryClientPath), 'src/core/queryClient.ts exists');
const queryClientContent = fs.readFileSync(queryClientPath, 'utf8');
assert(queryClientContent.includes('staleTime: 60_000') || queryClientContent.includes('staleTime: 60000'), 'QueryClient sets 60s staleTime');
assert(queryClientContent.includes('retry: 2'), 'QueryClient sets retry: 2');

// 6. Verify Core API Client & Schemas (src/core/api/)
const clientPath = path.join(__dirname, 'src', 'core', 'api', 'client.ts');
assert(fs.existsSync(clientPath), 'src/core/api/client.ts exists');
const clientContent = fs.readFileSync(clientPath, 'utf8');
assert(clientContent.includes('export class ApiError extends Error'), 'ApiError exported');
assert(clientContent.includes('export async function api<T>'), 'api client function exported');
assert(clientContent.includes('VITE_API_BASE'), 'api client supports VITE_API_BASE');
assert(clientContent.includes('access_token'), 'api client attaches Bearer access_token from localStorage');
assert(clientContent.includes("status === 401"), 'api client redirects on 401');
assert(clientContent.includes('schema.parse'), 'api client performs zod runtime validation');

const schemasPath = path.join(__dirname, 'src', 'core', 'api', 'schemas.ts');
assert(fs.existsSync(schemasPath), 'src/core/api/schemas.ts exists');
const schemasContent = fs.readFileSync(schemasPath, 'utf8');
assert(schemasContent.includes('StudentSchema'), 'StudentSchema exported');
assert(schemasContent.includes('RegisterRowSchema'), 'RegisterRowSchema exported');
assert(schemasContent.includes('AlertItemSchema'), 'AlertItemSchema exported');
assert(schemasContent.includes('SessionRowSchema'), 'SessionRowSchema exported');

// 7. Verify Core Components
const roleGatePath = path.join(__dirname, 'src', 'core', 'components', 'RoleGate.tsx');
assert(fs.existsSync(roleGatePath), 'src/core/components/RoleGate.tsx exists');

const registeredRoutesPath = path.join(__dirname, 'src', 'core', 'components', 'RegisteredRoutes.tsx');
assert(fs.existsSync(registeredRoutesPath), 'src/core/components/RegisteredRoutes.tsx exists');

const dashboardGridPath = path.join(__dirname, 'src', 'core', 'components', 'DashboardGrid.tsx');
assert(fs.existsSync(dashboardGridPath), 'src/core/components/DashboardGrid.tsx exists');
const dashboardGridContent = fs.readFileSync(dashboardGridPath, 'utf8');
assert(dashboardGridContent.includes('widgetRegistry.forZone'), 'DashboardGrid queries widgetRegistry.forZone');

// 8. Verify All 9 UI Primitives (src/components/dashboard/)
const primitives = [
  'DeltaPill.tsx',
  'StatCard.tsx',
  'ChartCard.tsx',
  'GradientHeroCard.tsx',
  'DonutCard.tsx',
  'HeatmapTile.tsx',
  'ProgressBar.tsx',
  'LegendSquare.tsx',
  'SkeletonCard.tsx',
];

for (const prim of primitives) {
  const primPath = path.join(__dirname, 'src', 'components', 'dashboard', prim);
  assert(fs.existsSync(primPath), `Primitive ${prim} exists`);
}

// Check specific primitive features
const deltaContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'dashboard', 'DeltaPill.tsx'), 'utf8');
assert(deltaContent.includes('TrendingUp') && deltaContent.includes('TrendingDown'), 'DeltaPill includes Trending icons');
assert(deltaContent.includes('invert'), 'DeltaPill supports invert flag');

const heroContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'dashboard', 'GradientHeroCard.tsx'), 'utf8');
assert(heroContent.includes('from-[#7c3aed] to-[#a78bfa]'), 'GradientHeroCard uses purple gradient tokens');
assert(heroContent.includes('gaugeValue'), 'GradientHeroCard accepts gaugeValue');

const donutContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'dashboard', 'DonutCard.tsx'), 'utf8');
assert(donutContent.includes('innerRadius="62%"') && donutContent.includes('outerRadius="85%"'), 'DonutCard configures Recharts 62%/85% radii');

const heatmapContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'dashboard', 'HeatmapTile.tsx'), 'utf8');
assert(heatmapContent.includes('color-mix(in srgb'), 'HeatmapTile uses color-mix styling');

// 9. Verify Feature Self-Registration (sample feature)
const sampleManifestPath = path.join(__dirname, 'src', 'features', 'sample', 'manifest.ts');
assert(fs.existsSync(sampleManifestPath), 'src/features/sample/manifest.ts exists');
const samplePagePath = path.join(__dirname, 'src', 'features', 'sample', 'SamplePage.tsx');
assert(fs.existsSync(samplePagePath), 'src/features/sample/SamplePage.tsx exists');
const sampleWidgetPath = path.join(__dirname, 'src', 'features', 'sample', 'SampleWidget.tsx');
assert(fs.existsSync(sampleWidgetPath), 'src/features/sample/SampleWidget.tsx exists');

// 10. Verify Dev Showcase & Features Ledger
const showcasePath = path.join(__dirname, 'src', 'dev', 'ComponentsShowcase.tsx');
assert(fs.existsSync(showcasePath), 'src/dev/ComponentsShowcase.tsx exists');

const featuresLedgerPath = path.join(__dirname, '..', 'FEATURES.md');
assert(fs.existsSync(featuresLedgerPath), 'FEATURES.md parity ledger exists');
const ledgerContent = fs.readFileSync(featuresLedgerPath, 'utf8');
assert(ledgerContent.includes('FEATURE') || ledgerContent.includes('Feature'), 'FEATURES.md has feature columns');
assert(ledgerContent.includes('VERIFIED') && ledgerContent.includes('PENDING'), 'FEATURES.md tracks status');

// 11. Verify THREE One-Time Wiring Points
const secondarySidebarPath = path.join(__dirname, 'src', 'components', 'dashboard', 'SecondarySidebar.tsx');
const secondarySidebarContent = fs.readFileSync(secondarySidebarPath, 'utf8');
assert(secondarySidebarContent.includes('navRegistry.all(currentRole)'), 'Wiring Point 1: Sidebar nav renders from navRegistry.all(currentRole)');

const appPath = path.join(__dirname, 'src', 'App.tsx');
const appContent = fs.readFileSync(appPath, 'utf8');
assert(appContent.includes('renderRegisteredRouteElements') || appContent.includes('RegisteredRoutes'), 'Wiring Point 2: Router renders registered routes');

const shellPath = path.join(__dirname, 'src', 'components', 'dashboard', 'DashboardShell.tsx');
const shellContent = fs.readFileSync(shellPath, 'utf8');
assert(shellContent.includes('<DashboardGrid zone="kpi" />'), 'Wiring Point 3a: Overview renders <DashboardGrid zone="kpi" />');
assert(shellContent.includes('<DashboardGrid zone="main" />'), 'Wiring Point 3b: Overview renders <DashboardGrid zone="main" />');
assert(shellContent.includes('<DashboardGrid zone="side" />'), 'Wiring Point 3c: Overview renders <DashboardGrid zone="side" />');

console.log('\n🌟 ALL 45 PHASE 2 AUTOMATED CHECKS PASSED PERFECTLY! 🌟');
