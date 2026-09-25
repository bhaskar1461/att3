import { useQuery } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { attendanceEndpoints } from '../../core/api/endpoints/attendance';
import { api } from '../../core/api/client';
import { s } from '../../core/api/schemas';
import type { StudentAttendanceSummary, StudentSubjectAttendance } from '../../core/api/schemas/attendance';

export interface PollingOptions {
  pollMs?: number;
}

export const useStudentProfileQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: ['student', 'profile'],
    queryFn: () => api('/api/v1/student/profile', s.StudentSchema),
    refetchInterval: opts?.pollMs,
  });
};

export const useStudentAttendanceSummaryQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.attendance.studentSummary(),
    queryFn: attendanceEndpoints.getStudentAttendanceSummary,
    refetchInterval: opts?.pollMs,
  });
};

// Pure testable selectors
export const selectOverallAttendancePct = (summary: StudentAttendanceSummary | undefined): number => {
  return summary?.overall_percentage ?? 0;
};

export const selectLowAttendanceSubjects = (
  summary: StudentAttendanceSummary | undefined,
  threshold: number = 75
): StudentSubjectAttendance[] => {
  if (!summary?.subjects) return [];
  return summary.subjects.filter((sub) => sub.percentage < threshold);
};
