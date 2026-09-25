import React, { useState } from 'react';
import { IconRail } from './IconRail';
import { SecondarySidebar } from './SecondarySidebar';
import { Topbar } from './Topbar';
import { BreadcrumbRow } from './BreadcrumbRow';
import { ContentGridPlaceholder } from './ContentGridPlaceholder';
import { DashboardGrid } from '../../core/components/DashboardGrid';
import { MockBanner } from './MockBanner';
import { useSidebarState } from '../../hooks/useSidebarState';
import { useNavigation } from '../../hooks/useNavigation';
import { useTheme } from '../../hooks/useTheme';

export const DashboardShell: React.FC = () => {
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

  const { railItems, sidebarItems, proCard, breadcrumb } = useNavigation(activeSection);

  const handleRailSelect = (id: string) => {
    setActiveRailId(id);
    const matchedItem = railItems.find((item) => item.id === id);
    if (matchedItem) {
      setActiveSection(matchedItem.label);
    }
  };

  const handleSidebarSelect = (id: string) => {
    setActiveSidebarId(id);
    const matchedItem = sidebarItems.find((item) => item.id === id);
    if (matchedItem) {
      setActiveSection(matchedItem.label);
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

        {/* Breadcrumb Row: Trail and Server-Time status */}
        <BreadcrumbRow breadcrumb={breadcrumb} />

        {/* 12-Column Content Grid Placeholder: Purple hero card, metric slots, charts, tables */}
        <main className="flex-1 pb-12">
          {/* Wiring Point 3: Overview page content area renders <DashboardGrid zone="..." /> for each zone */}
          <div className="p-4 sm:p-6 space-y-6">
            <DashboardGrid zone="kpi" />
            <DashboardGrid zone="main" />
            <DashboardGrid zone="side" />
          </div>
          <ContentGridPlaceholder />
        </main>
      </div>

      <MockBanner />
    </div>
  );
};
