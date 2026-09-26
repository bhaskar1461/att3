/**
 * Typed Mock API Service for University Attendance ERP Dashboard
 * Conforms to SNIST Identity Governance (SAP ID canonical identity)
 * and Server-Authoritative Time (IST / Asia/Kolkata).
 */

export interface UserProfile {
  id: string;
  sapId: string;
  name: string;
  role: string;
  department: string;
  email: string;
  avatarFallback: string;
  avatarUrl?: string;
}

export interface LiveAttendancePillData {
  presentToday: number | null;
  totalEnrolled: number;
  pillLabel: string;
  isLive: boolean;
}

export interface RailNavigationItem {
  id: string;
  label: string;
  iconName: string;
  path: string;
  tooltip: string;
  badgeCount?: number;
}

export interface SecondarySidebarItem {
  id: string;
  label: string;
  iconName: string;
  path: string;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'purple';
}

export interface ProInfoCardData {
  title: string;
  badge: string;
  description: string;
  buttonLabel: string;
  statusIndicator: 'healthy' | 'warning' | 'error';
}

export interface HeaderMetadata {
  livePillText: string;
  notificationCount: number;
  currentDateFormatted: string;
  serverTimezone: string;
  user: UserProfile;
}

export interface BreadcrumbData {
  rootLabel: string;
  sectionLabel: string;
  currentLabel: string;
}

// Canonical mock dataset
const MOCK_USER_PROFILE: UserProfile = {
  id: 'usr_admin_01',
  sapId: 'SNIST-ADM-1001',
  name: 'Dr. B. K. Sharma',
  role: 'Super Admin',
  department: 'Dean of Academic Affairs',
  email: 'admin.academics@sreenidhi.edu.in',
  avatarFallback: 'BS',
};

const MOCK_LIVE_PILL: LiveAttendancePillData = {
  presentToday: null, // Spec: live pill "Present today: —"
  totalEnrolled: 3450,
  pillLabel: 'Present today: —',
  isLive: true,
};

const MOCK_PRO_INFO_CARD: ProInfoCardData = {
  title: 'SNIST ERP Pro',
  badge: 'JNTUH R25',
  description: 'Biometric face-verify & 30-min device lock active across 8 branches.',
  buttonLabel: 'System Status: 100% OK',
  statusIndicator: 'healthy',
};

const MOCK_RAIL_NAV: RailNavigationItem[] = [
  { id: 'dashboard', label: 'Dashboard', iconName: 'LayoutDashboard', path: '/admin', tooltip: 'Live Attendance Overview' },
  { id: 'students', label: 'Students', iconName: 'Users', path: '/admin/management', tooltip: 'Student Master Directory' },
  { id: 'faculty', label: 'Faculty', iconName: 'GraduationCap', path: '/teacher', tooltip: 'Faculty Roster & Class Dispatch' },
  { id: 'sessions', label: 'Sessions', iconName: 'CalendarDays', path: '/admin/management?tab=sessions', tooltip: 'Timetable & Class Schedules' },
  { id: 'qr-gateways', label: 'QR Hub', iconName: 'QrCode', path: '/qr', tooltip: 'Projector QR Gateways' },
  { id: 'biometrics', label: 'Face AI', iconName: 'ScanFace', path: '/admin/legacy?tab=scanner_health', tooltip: 'Face Verification & Biometrics' },
  { id: 'devices', label: 'Devices', iconName: 'Smartphone', path: '/admin/legacy?tab=devices', tooltip: 'Device Binding & Telemetry' },
  { id: 'reports', label: 'Reports', iconName: 'FileSpreadsheet', path: '/reports', tooltip: 'Compliance & Export Reports' },
];

const MOCK_SECONDARY_SIDEBAR: SecondarySidebarItem[] = [
  { id: 'overview', label: 'Real-Time Overview', iconName: 'Activity', path: '/admin', badge: 'Live', badgeVariant: 'success' },
  { id: 'admin-operations', label: 'Admin Operations Hub', iconName: 'Layers', path: '/admin/legacy', badge: 'Hub', badgeVariant: 'purple' },
  { id: 'student-registry', label: 'Student Directory', iconName: 'Users', path: '/admin/management' },
  { id: 'faculty-roster', label: 'Faculty & Scanners', iconName: 'GraduationCap', path: '/teacher' },
  { id: 'sessions-grid', label: 'Class Timetables', iconName: 'CalendarDays', path: '/admin/management?tab=sessions' },
  { id: 'qr-projector', label: 'Projector Displays', iconName: 'QrCode', path: '/qr', badge: 'HD', badgeVariant: 'purple' },
  { id: 'face-audit', label: 'Face Verification', iconName: 'ScanFace', path: '/admin/legacy?tab=scanner_health' },
  { id: 'device-binding', label: 'Device Lockout (30m)', iconName: 'Smartphone', path: '/admin/legacy?tab=devices', badge: 'Secured', badgeVariant: 'default' },
  { id: 'compliance-r25', label: 'JNTUH R25 Compliance', iconName: 'ShieldAlert', path: '/admin/legacy?tab=compliance', badge: 'R25', badgeVariant: 'warning' },
  { id: 'reports-archive', label: 'Master Excel Reports', iconName: 'FileSpreadsheet', path: '/reports' },
  { id: 'system-setup', label: 'System Settings', iconName: 'Settings', path: '/admin/management' },
];

export const mockApi = {
  getUserProfile: async (): Promise<UserProfile> => {
    return Promise.resolve(MOCK_USER_PROFILE);
  },

  getLiveAttendancePill: async (): Promise<LiveAttendancePillData> => {
    return Promise.resolve(MOCK_LIVE_PILL);
  },

  getRailNavItems: async (): Promise<RailNavigationItem[]> => {
    return Promise.resolve(MOCK_RAIL_NAV);
  },

  getSecondarySidebarNav: async (): Promise<SecondarySidebarItem[]> => {
    return Promise.resolve(MOCK_SECONDARY_SIDEBAR);
  },

  getProInfoCardData: async (): Promise<ProInfoCardData> => {
    return Promise.resolve(MOCK_PRO_INFO_CARD);
  },

  getHeaderMetadata: async (): Promise<HeaderMetadata> => {
    // Server-Authoritative IST Date formatting
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const dateFormatted = `${formatter.format(now)} • IST`;

    return Promise.resolve({
      livePillText: MOCK_LIVE_PILL.pillLabel,
      notificationCount: 3,
      currentDateFormatted: dateFormatted,
      serverTimezone: 'Asia/Kolkata',
      user: MOCK_USER_PROFILE,
    });
  },

  getBreadcrumbData: async (currentSection: string = 'Live Operations'): Promise<BreadcrumbData> => {
    return Promise.resolve({
      rootLabel: 'Dashboard',
      sectionLabel: 'College Attendance',
      currentLabel: currentSection,
    });
  },
};
