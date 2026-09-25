import { useQuery } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { reportsEndpoints, ClassMatrixQueryParams } from '../../core/api/endpoints/reports';
import type { LowAttendanceStudent, ClassSheetMatrix } from '../../core/api/schemas/reports';

export interface PollingOptions {
  pollMs?: number;
}

export const useReportsLowAttendanceQuery = (threshold?: number, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.reports.lowAttendance(threshold),
    queryFn: () => reportsEndpoints.getLowAttendance(threshold),
    refetchInterval: opts?.pollMs,
  });
};

export const useReportsClassSheetMatrixQuery = (params?: ClassMatrixQueryParams, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.reports.classSheetMatrix(params),
    queryFn: () => reportsEndpoints.getClassSheetMatrix(params),
    enabled: !!params?.section_id,
    refetchInterval: opts?.pollMs,
  });
};

// Pure testable selectors
export const selectCriticalLowAttendance = (
  students: LowAttendanceStudent[] | undefined,
  criticalThreshold: number = 65
): LowAttendanceStudent[] => {
  if (!students) return [];
  return students.filter((s) => s.percentage < criticalThreshold);
};

export const selectMatrixDates = (matrix: ClassSheetMatrix | undefined): string[] => {
  return matrix?.dates || [];
};
