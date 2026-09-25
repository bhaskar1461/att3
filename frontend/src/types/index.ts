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
  assigned_count?: number;
  assigned_classes?: Array<{
    id: number;
    subject_code: string;
    subject_name: string;
    section_name: string;
    excel_file_name?: string;
    google_sheet_id?: string;
    google_sheet_url?: string;
  }>;
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
  excel_file_name?: string;
  has_excel_register?: boolean;
  google_sheet_id?: string;
  google_sheet_url?: string;
}

export interface AdminClassAssignment {
  id: number;
  teacher_id: number;
  teacher_code: string;
  teacher_name: string;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  section_id: number;
  section_name: string;
  department: string;
  academic_year: string;
  student_count: number;
  excel_file_name?: string;
  has_excel_register?: boolean;
  google_sheet_id?: string;
  google_sheet_url?: string;
}

export interface AttendanceSession {
  session_id: number;
  subject_id?: number;
  subject_code?: string;
  section_id?: number;
  subject_name: string;
  section_name: string;
  period: string;
  period_count?: number;
  session_date: string;
  status: 'OPEN' | 'LOCKED';
  total_students: number;
  present_count: number;
  absent_count: number;
  manual_count?: number;
  manual_pct?: number;
  anomaly_status?: 'NORMAL' | 'AMBER' | 'RED';
  students: StudentAttendanceStatus[];
  created_at?: string;
}

export interface StudentAttendanceStatus {
  student_id: number;
  roll_number: string;
  name: string;
  status: 'PRESENT' | 'ABSENT' | '4' | 'A';
  is_scanned: boolean;
  is_manual?: boolean;
  manual_reason?: string;
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
  period_count?: number;
  session_date: string;
  status: 'OPEN' | 'LOCKED';
  total_students: number;
  present_count: number;
  absent_count: number;
  manual_count?: number;
  manual_pct?: number;
  created_at?: string;
}

export * from './calendar.ts';

