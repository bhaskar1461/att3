import { useState, useEffect, useCallback } from 'react';

const SIDEBAR_STORAGE_KEY = 'snist-dashboard-sidebar-collapsed';

export function useSidebarState() {
  const [isCollapsed, setIsCollapsedState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) {
        return stored === 'true';
      }
    } catch (e) {
      console.warn('Unable to access localStorage for sidebar state', e);
    }
    // Default open on desktop
    return false;
  });

  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isCollapsed));
    } catch (e) {
      console.warn('Unable to persist sidebar state to localStorage', e);
    }
  }, [isCollapsed]);

  const toggleSidebar = useCallback(() => {
    setIsCollapsedState((prev) => !prev);
  }, []);

  const setCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsedState(collapsed);
  }, []);

  const toggleMobile = useCallback(() => {
    setIsMobileOpen((prev) => !prev);
  }, []);

  return {
    isCollapsed,
    toggleSidebar,
    setCollapsed,
    isMobileOpen,
    setIsMobileOpen,
    toggleMobile,
  };
}
