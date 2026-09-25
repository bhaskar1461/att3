import { api } from '../client';
import { s } from '../schemas';

export interface ClassMatrixQueryParams {
  section_id?: number;
  subject_id?: number;
  start_date?: string;
  end_date?: string;
}

export interface ReportExportParams {
  format?: 'csv' | 'excel' | 'pdf';
  section_id?: number;
  subject_id?: number;
  start_date?: string;
  end_date?: string;
}

export const reportsEndpoints = {
  getLowAttendance: (threshold?: number) => {
    const q = threshold !== undefined ? `?threshold=${threshold}` : '';
    return api(`/api/v1/reports/low-attendance${q}`, s.LowAttendanceListSchema);
  },

  getClassSheetMatrix: (params?: ClassMatrixQueryParams) => {
    const qp = new URLSearchParams();
    if (params?.section_id) qp.set('section_id', String(params.section_id));
    if (params?.subject_id) qp.set('subject_id', String(params.subject_id));
    if (params?.start_date) qp.set('start_date', params.start_date);
    if (params?.end_date) qp.set('end_date', params.end_date);
    const query = qp.toString() ? `?${qp.toString()}` : '';
    return api(`/api/v1/reports/class-sheet-matrix${query}`, s.ClassSheetMatrixSchema);
  },

  getExportDownloadUrl: (params: ReportExportParams) => {
    const format = params.format || 'csv';
    const qp = new URLSearchParams();
    if (params.section_id) qp.set('section_id', String(params.section_id));
    if (params.subject_id) qp.set('subject_id', String(params.subject_id));
    if (params.start_date) qp.set('start_date', params.start_date);
    if (params.end_date) qp.set('end_date', params.end_date);
    const query = qp.toString() ? `?${qp.toString()}` : '';
    const base = import.meta.env.VITE_API_BASE ?? '';
    return `${base}/api/v1/reports/export/${format}${query}`;
  },
};
