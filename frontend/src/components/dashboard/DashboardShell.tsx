import React, { useState, useMemo } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { IconRail } from './IconRail';
import { SecondarySidebar } from './SecondarySidebar';
import { Topbar } from './Topbar';
import { BreadcrumbRow } from './BreadcrumbRow';
import { DashboardGrid } from '../../core/components/DashboardGrid';
import { MockBanner } from './MockBanner';
import { useSidebarState } from '../../hooks/useSidebarState';
import { useNavigation } from '../../hooks/useNavigation';
import { useTheme } from '../../hooks/useTheme';
import { useAuth } from '../../features/auth/hooks';
import { navRegistry, routeRegistry } from '../../core/registries';
import { BreadcrumbData } from '../../services/mockApi';

export interface DashboardShellProps {
  children?: React.ReactNode;
}

export const DashboardShell: React.FC<DashboardShellProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Theme hook: sets dark/light classes on document root and persists to localStorage
  useTheme();

  // Sidebar collapse persistence to localStorage
  const {
    isCollapsed,
    toggleSidebar,
    isMobileOpen,
    setIsMobileOpen,
    toggleMobile,
  } = useSidebarState();

  const [activeRailId, setActiveRailId] = useState<string>('dashboard');

  const [searchParams, setSearchParams] = useSearchParams();
  const rawRange = searchParams.get('range');
  const range: 'today' | 'week' | 'month' =
    rawRange === 'today' || rawRange === 'week' || rawRange === 'month'
      ? rawRange
      : 'week'; // default week per Phase 7/8 specs

  const handleRangeChange = (newRange: 'today' | 'week' | 'month') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('range', newRange);
      return next;
    });
  };

  const { user } = useAuth();
  const currentRole = (user?.role || '').toLowerCase().includes('teacher') ? 'teacher' : 'admin';

  const { railItems, proCard } = useNavigation();

  // Dynamic route & section discovery for clean breadcrumbs and active item
  const currentCleanPath = location.pathname.split('?')[0].split('#')[0];
  const allNavs = navRegistry.all(currentRole);
  const matchedNav = allNavs.find((n) => n.path === currentCleanPath);
  const matchedRoute = routeRegistry.all().find((r) => r.path === currentCleanPath);

  const activeSidebarId = matchedNav?.id || currentCleanPath;

  const derivedBreadcrumb: BreadcrumbData = useMemo(() => {
    let section = 'Dashboard';
    if (matchedNav?.section) {
      section = matchedNav.section;
    } else if (currentCleanPath.startsWith('/roster')) {
      section = 'Roster';
    } else if (currentCleanPath.startsWith('/devices')) {
      section = 'Devices';
    } else if (currentCleanPath.startsWith('/sessions')) {
      section = 'Sessions';
    } else if (currentCleanPath.startsWith('/security')) {
      section = 'Security';
    } else if (currentCleanPath.startsWith('/onboarding')) {
      section = 'Onboarding';
    } else if (currentCleanPath.startsWith('/admin')) {
      section = 'Admin';
    } else if (currentCleanPath.startsWith('/attendance')) {
      section = 'Attendance';
    }

    const title =
      matchedRoute?.title ||
      matchedNav?.label ||
      (currentCleanPath === '/dashboard' || currentCleanPath === '/overview'
        ? 'Overview'
        : 'Dashboard');

    return {
      rootLabel: 'Home',
      sectionLabel: section.charAt(0).toUpperCase() + section.slice(1).toLowerCase(),
      currentLabel: title,
    };
  }, [currentCleanPath, matchedNav, matchedRoute]);

  const handleRailSelect = (id: string) => {
    setActiveRailId(id);
    const matchedItem = railItems.find((item) => item.id === id);
    if (matchedItem && matchedItem.path && matchedItem.path !== location.pathname) {
      navigate(matchedItem.path);
    }
  };

  const handleSidebarSelect = (id: string) => {
    const matchedEntry = allNavs.find((item) => item.id === id || item.path === id);
    if (matchedEntry && matchedEntry.path !== location.pathname) {
      navigate(matchedEntry.path);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#141416] text-[#f8fafc] font-sans flex antialiased selection:bg-indigo-600 selection:text-white overflow-x-hidden">
      {/* Desktop Navigation Shell (>= 1024px) */}
      <div className="hidden lg:flex shrink-0">
        {/* 56px Icon Rail */}
        <IconRail
          items={railItems}
          activeId={activeRailId}
          onSelect={handleRailSelect}
          isSidebarCollapsed={isCollapsed}
          onToggleSidebar={toggleSidebar}
        />

        {/* 240px Collapsible Secondary Sidebar (100% registry-driven) */}
        <SecondarySidebar
          activeId={activeSidebarId}
          onSelect={handleSidebarSelect}
          isCollapsed={isCollapsed}
          proCard={proCard}
          currentRole={currentRole}
        />
      </div>

      {/* Mobile / Tablet Drawer Overlay (< 1024px) */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden transition-opacity"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Drawer Content (< 1024px) */}
      <div
        className={`fixed top-0 bottom-0 left-0 z-50 flex lg:hidden transform transition-transform duration-300 ease-in-out ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <IconRail
          items={railItems}
          activeId={activeRailId}
          onSelect={(id) => {
            handleRailSelect(id);
          }}
          isSidebarCollapsed={false}
          onToggleSidebar={toggleSidebar}
        />
        <SecondarySidebar
          activeId={activeSidebarId}
          onSelect={(id) => {
            handleSidebarSelect(id);
            setIsMobileOpen(false);
          }}
          isCollapsed={false}
          proCard={proCard}
          currentRole={currentRole}
          onCloseMobile={() => setIsMobileOpen(false)}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#141416]">
        {/* Topbar: Global search, live pill, theme toggle, calendar, bell, avatar */}
        <Topbar
          isMobileSidebarOpen={isMobileOpen}
          onToggleMobileSidebar={toggleMobile}
        />

        {/* Breadcrumb Row: Trail and Server-Time status with Range Selector */}
        <BreadcrumbRow
          breadcrumb={derivedBreadcrumb}
          range={range}
          onRangeChange={handleRangeChange}
        />

        {/* Dynamic Page Content OR 12-Column Responsive Dashboard Overview Grid */}
        <main className="flex-1 pb-12">
          {children ? (
            <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
              {children}
            </div>
          ) : (
            <div className="p-4 sm:p-6 space-y-6">
              <DashboardGrid zone="kpi" role={currentRole} range={range} />
              <div className="grid grid-cols-12 gap-6">
                <DashboardGrid zone="main" role={currentRole} range={range} />
                <DashboardGrid zone="side" role={currentRole} range={range} />
              </div>
            </div>
          )}
        </main>
      </div>

      <MockBanner />
    </div>
  );
};

export default DashboardShell;
