import { z } from 'zod';
import { api } from '../client';
import { s } from '../schemas';
import type { Student } from '../schemas/roster';

export interface StudentQueryParams {
  page?: number;
  page_size?: number;
  q?: string;
  section_id?: number;
  department_id?: number;
}

export const rosterEndpoints = {
  listStudents: (params?: StudentQueryParams) => {
    const qp = new URLSearchParams();
    if (params?.page) qp.set('page', String(params.page));
    if (params?.page_size) qp.set('page_size', String(params.page_size));
    if (params?.q) qp.set('q', params.q);
    if (params?.section_id) qp.set('section_id', String(params.section_id));
    if (params?.department_id) qp.set('department_id', String(params.department_id));
    const query = qp.toString() ? `?${qp.toString()}` : '';
    return api(`/api/v1/admin/students${query}`, s.StudentListSchema);
  },

  listTeachers: () =>
    api('/api/v1/admin/teachers', s.TeacherListSchema),

  listDepartments: () =>
    api('/api/v1/admin/departments', s.DepartmentListSchema),

  listSections: () =>
    api('/api/v1/admin/sections', s.SectionListSchema),

  listSubjects: () =>
    api('/api/v1/admin/subjects', s.SubjectListSchema),

  listYears: () =>
    api('/api/v1/admin/years', s.AcademicYearListSchema),

  saveStudent: (data: Partial<Student>) =>
    api('/api/v1/admin/students', s.StudentSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTeacherGoogleSheet: (teacherId: number, googleSheetUrl: string) =>
    api(`/api/v1/admin/teachers/${teacherId}/google-sheet`, z.record(z.string(), z.unknown()), {
      method: 'PUT',
      body: JSON.stringify({ google_sheet_url: googleSheetUrl }),
    }),
};
