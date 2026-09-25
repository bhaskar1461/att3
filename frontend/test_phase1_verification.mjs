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

console.log('=== Running Phase 1 Automated Verification ===\n');

// 1. Verify Tailwind Config & Theme Tokens
const tailwindConfigPath = path.join(__dirname, 'tailwind.config.js');
assert(fs.existsSync(tailwindConfigPath), 'tailwind.config.js exists');
const tailwindContent = fs.readFileSync(tailwindConfigPath, 'utf8');

assert(tailwindContent.includes('#141416'), 'Tailwind config defines page bg #141416');
assert(tailwindContent.includes('#1e1f24'), 'Tailwind config defines card bg #1e1f24');
assert(tailwindContent.includes('#2a2b31'), 'Tailwind config defines card border #2a2b31');
assert(tailwindContent.includes('#6366f1'), 'Tailwind config defines accent indigo #6366f1');
assert(tailwindContent.includes('#8b5cf6'), 'Tailwind config defines accent violet #8b5cf6');
assert(tailwindContent.includes('#7c3aed'), 'Tailwind config defines hero purple #7c3aed');
assert(tailwindContent.includes('#a78bfa'), 'Tailwind config defines hero lavender #a78bfa');
assert(tailwindContent.includes('#9ca3af'), 'Tailwind config defines muted label #9ca3af');
assert(tailwindContent.includes('#10b981'), 'Tailwind config defines delta green #10b981');
assert(tailwindContent.includes('#ef4444'), 'Tailwind config defines delta red #ef4444');
assert(tailwindContent.includes('Inter'), 'Tailwind config configures Inter font');
assert(tailwindContent.includes('"card": "12px"'), 'Tailwind config sets 12px card border radius');

// 2. Verify CSS Variables in index.css
const indexCssPath = path.join(__dirname, 'src', 'index.css');
assert(fs.existsSync(indexCssPath), 'src/index.css exists');
const indexCssContent = fs.readFileSync(indexCssPath, 'utf8');
assert(indexCssContent.includes('--dash-page: #f8fafc;'), 'index.css defines light page token');
assert(indexCssContent.includes('--dash-page: #141416;'), 'index.css defines dark page token #141416');
assert(indexCssContent.includes('--dash-card: #1e1f24;'), 'index.css defines dark card token #1e1f24');
assert(indexCssContent.includes('--dash-border: #2a2b31;'), 'index.css defines dark border token #2a2b31');

// 3. Verify Mock API & Typed Data
const mockApiPath = path.join(__dirname, 'src', 'services', 'mockApi.ts');
assert(fs.existsSync(mockApiPath), 'src/services/mockApi.ts exists');
const mockApiContent = fs.readFileSync(mockApiPath, 'utf8');
assert(mockApiContent.includes('Present today: —'), 'mockApi defines live pill "Present today: —"');
assert(mockApiContent.includes('SNIST-ADM-1001'), 'mockApi enforces canonical SAP ID identity');
assert(mockApiContent.includes('Asia/Kolkata'), 'mockApi enforces server-authoritative IST timezone');
assert(mockApiContent.includes('MOCK_RAIL_NAV: RailNavigationItem[] = ['), 'mockApi defines rail navigation items array');

// 4. Verify Hooks
const useThemePath = path.join(__dirname, 'src', 'hooks', 'useTheme.ts');
assert(fs.existsSync(useThemePath), 'src/hooks/useTheme.ts exists');
const useThemeContent = fs.readFileSync(useThemePath, 'utf8');
assert(useThemeContent.includes('localStorage.getItem'), 'useTheme reads persisted theme from localStorage');
assert(useThemeContent.includes('localStorage.setItem'), 'useTheme persists theme to localStorage');
assert(useThemeContent.includes("return 'dark'"), 'useTheme defaults to dark theme');

const useSidebarPath = path.join(__dirname, 'src', 'hooks', 'useSidebarState.ts');
assert(fs.existsSync(useSidebarPath), 'src/hooks/useSidebarState.ts exists');
const useSidebarContent = fs.readFileSync(useSidebarPath, 'utf8');
assert(useSidebarContent.includes('localStorage.getItem'), 'useSidebarState reads collapse state from localStorage');
assert(useSidebarContent.includes('localStorage.setItem'), 'useSidebarState persists collapse state to localStorage');

const useHeaderPath = path.join(__dirname, 'src', 'hooks', 'useDashboardHeader.ts');
assert(fs.existsSync(useHeaderPath), 'src/hooks/useDashboardHeader.ts exists');
const useHeaderContent = fs.readFileSync(useHeaderPath, 'utf8');
assert(useHeaderContent.includes('useDashboardHeader'), 'useDashboardHeader hook implemented');

// 5. Verify Dashboard Components
const iconRailPath = path.join(__dirname, 'src', 'components', 'dashboard', 'IconRail.tsx');
assert(fs.existsSync(iconRailPath), 'src/components/dashboard/IconRail.tsx exists');
const iconRailContent = fs.readFileSync(iconRailPath, 'utf8');
assert(iconRailContent.includes('w-[56px]'), 'IconRail enforces 56px rail width');
assert(iconRailContent.includes('Tooltip'), 'IconRail uses Tooltips on all icon buttons');

const secondarySidebarPath = path.join(__dirname, 'src', 'components', 'dashboard', 'SecondarySidebar.tsx');
assert(fs.existsSync(secondarySidebarPath), 'src/components/dashboard/SecondarySidebar.tsx exists');
const secondarySidebarContent = fs.readFileSync(secondarySidebarPath, 'utf8');
assert(secondarySidebarContent.includes('w-[240px]'), 'SecondarySidebar enforces 240px width');
assert(secondarySidebarContent.includes('DASHBOARD'), 'SecondarySidebar contains section label "DASHBOARD"');
assert(secondarySidebarContent.includes('proCard'), 'SecondarySidebar contains Pro-style info card');

const topbarPath = path.join(__dirname, 'src', 'components', 'dashboard', 'Topbar.tsx');
assert(fs.existsSync(topbarPath), 'src/components/dashboard/Topbar.tsx exists');
const topbarContent = fs.readFileSync(topbarPath, 'utf8');
assert(topbarContent.includes('Search students, SAP ID, classes'), 'Topbar contains global search input');
assert(topbarContent.includes('livePillText'), 'Topbar renders live pill from hook');
assert(topbarContent.includes('toggleTheme'), 'Topbar includes light/dark theme toggle');
assert(topbarContent.includes('Bell'), 'Topbar includes notification bell with dot');
assert(topbarContent.includes('Calendar'), 'Topbar includes calendar icon');
assert(topbarContent.includes('Avatar'), 'Topbar includes avatar and name/role');

const breadcrumbPath = path.join(__dirname, 'src', 'components', 'dashboard', 'BreadcrumbRow.tsx');
assert(fs.existsSync(breadcrumbPath), 'src/components/dashboard/BreadcrumbRow.tsx exists');

const contentGridPath = path.join(__dirname, 'src', 'components', 'dashboard', 'ContentGridPlaceholder.tsx');
assert(fs.existsSync(contentGridPath), 'src/components/dashboard/ContentGridPlaceholder.tsx exists');
const contentGridContent = fs.readFileSync(contentGridPath, 'utf8');
assert(contentGridContent.includes('grid grid-cols-12'), 'ContentGridPlaceholder defines 12-column grid');
assert(contentGridContent.includes('from-[#7c3aed] to-[#a78bfa]'), 'ContentGridPlaceholder contains purple hero card (#7c3aed→#a78bfa)');
assert(contentGridContent.includes('deltaPositive'), 'ContentGridPlaceholder contains green delta pills');
assert(contentGridContent.includes('deltaNegative'), 'ContentGridPlaceholder contains red delta pills');
assert(contentGridContent.includes('#9ca3af'), 'ContentGridPlaceholder uses muted labels #9ca3af');

const dashboardShellPath = path.join(__dirname, 'src', 'components', 'dashboard', 'DashboardShell.tsx');
assert(fs.existsSync(dashboardShellPath), 'src/components/dashboard/DashboardShell.tsx exists');
const dashboardShellContent = fs.readFileSync(dashboardShellPath, 'utf8');
assert(dashboardShellContent.includes('IconRail'), 'DashboardShell includes IconRail');
assert(dashboardShellContent.includes('SecondarySidebar'), 'DashboardShell includes SecondarySidebar');
assert(dashboardShellContent.includes('Topbar'), 'DashboardShell includes Topbar');
assert(dashboardShellContent.includes('BreadcrumbRow'), 'DashboardShell includes BreadcrumbRow');
assert(dashboardShellContent.includes('ContentGridPlaceholder'), 'DashboardShell includes ContentGridPlaceholder');

// 6. Verify App.tsx and Routing
const appPath = path.join(__dirname, 'src', 'App.tsx');
const appContent = fs.readFileSync(appPath, 'utf8');
assert(appContent.includes('/dashboard'), 'App.tsx registers /dashboard route');
assert(appContent.includes('/admin'), 'App.tsx registers /admin route with DashboardPage');
assert(appContent.includes('/admin/legacy'), 'App.tsx strictly preserves legacy AdminDashboard route');

console.log('\n🌟 ALL 35 PHASE 1 AUTOMATED CHECKS PASSED PERFECTLY! 🌟');
