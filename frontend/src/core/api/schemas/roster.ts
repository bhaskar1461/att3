import { z } from 'zod';

export const StudentSchema = z.object({
  id: z.number(),
  roll_number: z.string(),
  name: z.string(),
  department: z.string().optional().nullable(),
  year: z.string().optional().nullable(),
  section: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  sap_id: z.string().optional().nullable(),
  join_date: z.string().optional().nullable(),
  is_active: z.boolean().optional().nullable(),
});
export type Student = z.infer<typeof StudentSchema>;

export const StudentPaginationEnvelopeSchema = z.object({
  items: z.array(StudentSchema),
  total: z.number(),
  page: z.number().optional().nullable(),
  page_size: z.number().optional().nullable(),
  total_pages: z.number().optional().nullable(),
});
export type StudentPaginationEnvelope = z.infer<typeof StudentPaginationEnvelopeSchema>;

export const StudentListSchema = z.union([
  z.array(StudentSchema),
  StudentPaginationEnvelopeSchema,
]);
export type StudentList = z.infer<typeof StudentListSchema>;

export const TeacherSchema = z.object({
  id: z.number(),
  teacher_code: z.string().optional().nullable(),
  name: z.string(),
  department: z.string().optional().nullable(),
  department_id: z.number().optional().nullable(),
  mobile: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  google_sheet_id: z.string().optional().nullable(),
  google_sheet_url: z.string().optional().nullable(),
  assigned_count: z.number().optional().nullable(),
});
export type Teacher = z.infer<typeof TeacherSchema>;

export const TeacherListSchema = z.array(TeacherSchema);
export type TeacherList = z.infer<typeof TeacherListSchema>;

export const DepartmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  code: z.string(),
});
export type Department = z.infer<typeof DepartmentSchema>;

export const DepartmentListSchema = z.array(DepartmentSchema);
export type DepartmentList = z.infer<typeof DepartmentListSchema>;

export const SectionSchema = z.object({
  id: z.number(),
  name: z.string(),
  department_id: z.number().optional().nullable(),
  department: z.string().optional().nullable(),
  academic_year_id: z.number().optional().nullable(),
  year: z.string().optional().nullable(),
});
export type Section = z.infer<typeof SectionSchema>;

export const SectionListSchema = z.array(SectionSchema);
export type SectionList = z.infer<typeof SectionListSchema>;

export const SubjectSchema = z.object({
  id: z.number(),
  name: z.string(),
  code: z.string(),
  department_id: z.number().optional().nullable(),
  academic_year_id: z.number().optional().nullable(),
});
export type Subject = z.infer<typeof SubjectSchema>;

export const SubjectListSchema = z.array(SubjectSchema);
export type SubjectList = z.infer<typeof SubjectListSchema>;

export const AcademicYearSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type AcademicYear = z.infer<typeof AcademicYearSchema>;

export const AcademicYearListSchema = z.array(AcademicYearSchema);
export type AcademicYearList = z.infer<typeof AcademicYearListSchema>;
