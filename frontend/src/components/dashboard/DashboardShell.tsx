import React, { useState } from 'react';
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

export const DashboardShell: React.FC = () => {
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

  // Navigation data from typed mockApi hook
  const [activeSection, setActiveSection] = useState<string>('Live Overview');
  const [activeRailId, setActiveRailId] = useState<string>('dashboard');
  const [activeSidebarId, setActiveSidebarId] = useState<string>('overview');

  const [searchParams, setSearchParams] = useSearchParams();
  const rawRange = searchParams.get('range');
  const range: 'today' | 'week' | 'month' =
    rawRange === 'today' || rawRange === 'week' || rawRange === 'month'
      ? rawRange
      : 'today'; // default today

  const handleRangeChange = (newRange: 'today' | 'week' | 'month') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('range', newRange);
      return next;
    });
  };

  const { user } = useAuth();
  const currentRole = (user?.role || '').toLowerCase() === 'teacher' ? 'teacher' : 'admin';

  const { railItems, sidebarItems, proCard, breadcrumb } = useNavigation(activeSection);

  const handleRailSelect = (id: string) => {
    setActiveRailId(id);
    const matchedItem = railItems.find((item) => item.id === id);
    if (matchedItem) {
      setActiveSection(matchedItem.label);
      if (matchedItem.path && matchedItem.path !== location.pathname && matchedItem.path !== '/dashboard') {
        navigate(matchedItem.path);
      }
    }
  };

  const handleSidebarSelect = (id: string) => {
    setActiveSidebarId(id);
    const matchedItem = sidebarItems.find((item) => item.id === id);
    if (matchedItem) {
      setActiveSection(matchedItem.label);
      if (matchedItem.path && matchedItem.path !== location.pathname && matchedItem.path !== '/dashboard') {
        navigate(matchedItem.path);
      }
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

        {/* 240px Collapsible Secondary Sidebar */}
        <SecondarySidebar
          items={sidebarItems}
          activeId={activeSidebarId}
          onSelect={handleSidebarSelect}
          isCollapsed={isCollapsed}
          proCard={proCard}
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
          items={sidebarItems}
          activeId={activeSidebarId}
          onSelect={(id) => {
            handleSidebarSelect(id);
            setIsMobileOpen(false);
          }}
          isCollapsed={false}
          proCard={proCard}
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
          breadcrumb={breadcrumb}
          range={range}
          onRangeChange={handleRangeChange}
        />

        {/* 12-Column Responsive Dashboard Grid: KPI row on top, Main (col-8) + Side (col-4) below */}
        <main className="flex-1 pb-12">
          <div className="p-4 sm:p-6 space-y-6">
            <DashboardGrid zone="kpi" role={currentRole} range={range} />
            <div className="grid grid-cols-12 gap-6">
              <DashboardGrid zone="main" role={currentRole} range={range} />
              <DashboardGrid zone="side" role={currentRole} range={range} />
            </div>
          </div>
        </main>
      </div>

      <MockBanner />
    </div>
  );
};
