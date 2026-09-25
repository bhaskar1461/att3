import { useState, useEffect } from 'react';
import {
  mockApi,
  RailNavigationItem,
  SecondarySidebarItem,
  ProInfoCardData,
  BreadcrumbData,
} from '../services/mockApi';

export interface NavigationState {
  railItems: RailNavigationItem[];
  sidebarItems: SecondarySidebarItem[];
  proCard: ProInfoCardData | null;
  breadcrumb: BreadcrumbData;
  isLoading: boolean;
}

export function useNavigation(activeSection: string = 'Live Operations'): NavigationState {
  const [navState, setNavState] = useState<NavigationState>({
    railItems: [],
    sidebarItems: [],
    proCard: null,
    breadcrumb: {
      rootLabel: 'Dashboard',
      sectionLabel: 'College Attendance',
      currentLabel: activeSection,
    },
    isLoading: true,
  });

  useEffect(() => {
    let isMounted = true;
    async function loadNavigation() {
      try {
        const [railItems, sidebarItems, proCard, breadcrumb] = await Promise.all([
          mockApi.getRailNavItems(),
          mockApi.getSecondarySidebarNav(),
          mockApi.getProInfoCardData(),
          mockApi.getBreadcrumbData(activeSection),
        ]);

        if (isMounted) {
          setNavState({
            railItems,
            sidebarItems,
            proCard,
            breadcrumb,
            isLoading: false,
          });
        }
      } catch (err) {
        console.error('Failed to load navigation configuration', err);
        if (isMounted) {
          setNavState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    }
    loadNavigation();
    return () => {
      isMounted = false;
    };
  }, [activeSection]);

  return navState;
}
