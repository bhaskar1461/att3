export type UserRole = 'SUPER_ADMIN' | 'TEACHER' | 'STUDENT';

export interface UserProfile {
  id: number;
  username: string;
  email?: string;
  role: UserRole;
  full_name: string;
}

export interface Department {
  id: number;
  code: string;
  name: string;
}

export interface AcademicYear {
  id: number;
  name: string;
}

export interface Section {
  id: number;
  name: string;
  department_id: number;
  department?: string;
  academic_year_id: number;
  year?: string;
}

export interface Subject {
  id: number;
  code: string;
  name: string;
  department_id: number;
  department?: string;
  academic_year_id: number;
  year?: string;
}

export interface Teacher {
  id: number;
  teacher_code: string;
  name: string;
  department: string;
  department_id: number;
  mobile?: string;
  username: string;
  google_sheet_id?: string;
  google_sheet_url?: string;
}

export interface Student {
  id: number;
  roll_number: string;
  name: string;
  department: string;
  year: string;
  section: string;
  email?: string;
  mobile?: string;
  agency?: string;
}

export interface TeacherAssignment {
  assignment_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  section_id: number;
  section_name: string;
  department: string;
  year: string;
}

export interface AttendanceSession {
  session_id: number;
  section_id?: number;
  classroom_id?: number;
  classroom_code?: string;
  current_challenge?: string;
  manual_fallback_code?: string;
  subject_name: string;
  section_name: string;
  period: string;
  session_date: string;
  status: 'OPEN' | 'LOCKED';
  total_students: number;
  present_count: number;
  absent_count: number;
  students: StudentAttendanceStatus[];
}

export interface StudentAttendanceStatus {
  student_id: number;
  roll_number: string;
  name: string;
  status: 'PRESENT' | 'ABSENT' | '4' | 'A';
  is_scanned: boolean;
}

export interface DashboardStats {
  total_students: number;
  total_teachers: number;
  total_departments: number;
  present_today: number;
  absent_today: number;
  attendance_percentage: number;
  active_live_classes: number;
}

export interface HistoricalAttendanceSession {
  session_id: number;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  section_id: number;
  section_name: string;
  period: string;
  session_date: string;
  status: 'OPEN' | 'LOCKED';
  total_students: number;
  present_count: number;
  absent_count: number;
  created_at?: string;
}

export interface Classroom {
  id: number;
  room_code: string;
  building: string;
  floor: number;
  center_latitude: number;
  center_longitude: number;
  geofence_radius_meters: number;
  default_rssi_threshold: number;
  uwb_supported: boolean;
}

export interface ProximitySessionData {
  session_id: number;
  status: string;
  session_date: string;
  period: string;
  classroom_id?: number;
  classroom_code?: string;
  broadcast_payload: string;
  challenge_nonce: string;
  manual_fallback_code: string;
  remaining_seconds: number;
  rssi_threshold: number;
  geofence_radius_meters: number;
  total_enrolled?: number;
  total_marked?: number;
}

export interface AuditReview {
  id: number;
  session_id: number;
  student_id: number;
  roll_number?: string;
  student_name?: string;
  reason_flag: string;
  measured_rssi?: number;
  measured_distance_meters?: number;
  details?: Record<string, any>;
  created_at: string;
}


