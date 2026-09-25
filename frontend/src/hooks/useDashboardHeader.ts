import { useState, useEffect } from 'react';
import { mockApi, HeaderMetadata, UserProfile } from '../services/mockApi';

export interface DashboardHeaderState {
  livePillText: string;
  notificationCount: number;
  currentDateFormatted: string;
  user: UserProfile;
  isLoading: boolean;
}

const DEFAULT_HEADER_STATE: DashboardHeaderState = {
  livePillText: 'Present today: —',
  notificationCount: 0,
  currentDateFormatted: '',
  user: {
    id: '',
    sapId: 'SNIST-ADM-1001',
    name: 'Dr. B. K. Sharma',
    role: 'Super Admin',
    department: 'Academics',
    email: 'admin@sreenidhi.edu.in',
    avatarFallback: 'BS',
  },
  isLoading: true,
};

export function useDashboardHeader(): DashboardHeaderState {
  const [headerState, setHeaderState] = useState<DashboardHeaderState>(DEFAULT_HEADER_STATE);

  useEffect(() => {
    let isMounted = true;
    async function loadHeader() {
      try {
        const metadata: HeaderMetadata = await mockApi.getHeaderMetadata();
        if (isMounted) {
          setHeaderState({
            livePillText: metadata.livePillText,
            notificationCount: metadata.notificationCount,
            currentDateFormatted: metadata.currentDateFormatted,
            user: metadata.user,
            isLoading: false,
          });
        }
      } catch (err) {
        console.error('Failed to load dashboard header metadata', err);
        if (isMounted) {
          setHeaderState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    }
    loadHeader();
    return () => {
      isMounted = false;
    };
  }, []);

  return headerState;
}
