import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { rosterEndpoints, StudentQueryParams } from '../../core/api/endpoints/roster';
import { invalidateFor } from '../../core/api/invalidation';
import type { Student, StudentList } from '../../core/api/schemas/roster';

export interface PollingOptions {
  pollMs?: number;
}

export const useRosterStudentsQuery = (params?: StudentQueryParams, opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.roster.students(params),
    queryFn: () => rosterEndpoints.listStudents(params),
    refetchInterval: opts?.pollMs,
  });
};

export const useRosterSearchQuery = (searchQuery: string, opts?: PollingOptions) => {
  const params: StudentQueryParams = { q: searchQuery };
  return useQuery({
    queryKey: keys.roster.students(params),
    queryFn: () => rosterEndpoints.listStudents(params),
    enabled: searchQuery.trim().length > 0,
    refetchInterval: opts?.pollMs,
  });
};

export const useRosterTeachersQuery = (opts?: PollingOptions) => {
  return useQuery({
    queryKey: keys.roster.teachers(),
    queryFn: rosterEndpoints.listTeachers,
    refetchInterval: opts?.pollMs,
  });
};

export const useRosterDepartmentsQuery = () => {
  return useQuery({
    queryKey: keys.roster.departments(),
    queryFn: rosterEndpoints.listDepartments,
  });
};

export const useRosterSectionsQuery = () => {
  return useQuery({
    queryKey: keys.roster.sections(),
    queryFn: rosterEndpoints.listSections,
  });
};

export const useRosterSubjectsQuery = () => {
  return useQuery({
    queryKey: keys.roster.subjects(),
    queryFn: rosterEndpoints.listSubjects,
  });
};

export const useRosterYearsQuery = () => {
  return useQuery({
    queryKey: keys.roster.years(),
    queryFn: rosterEndpoints.listYears,
  });
};

export const useRosterSaveStudentMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rosterEndpoints.saveStudent,
    onSettled: () => invalidateFor(qc, 'roster.saveStudent'),
  });
};

export const useRosterUpdateTeacherSheetMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teacherId, googleSheetUrl }: { teacherId: number; googleSheetUrl: string }) =>
      rosterEndpoints.updateTeacherGoogleSheet(teacherId, googleSheetUrl),
    onSettled: () => invalidateFor(qc, 'roster.updateTeacherSheet'),
  });
};

// Pure testable selectors
export const selectStudentsList = (data: StudentList | undefined): Student[] => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.items || [];
};

export const selectActiveStudentsCount = (students: Student[]): number => {
  return students.filter((s) => s.is_active !== false).length;
};

export const selectStudentsByDepartment = (students: Student[], departmentCode: string): Student[] => {
  return students.filter((s) => s.department === departmentCode);
};
