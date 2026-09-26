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

// Refactor 1: Extracted report download hook
import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type DownloadState = 'idle' | 'requesting' | 'building';

export interface ReportDownloadParams {
  type?: string;
  range?: string;
  format?: string;
  session_id?: number | string;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}

export const useReportDownload = (defaultParams?: ReportDownloadParams) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<DownloadState>('idle');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const pollIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const handleDownloadFile = async (downloadUrl: string, filenameSuffix?: string) => {
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('access_token') || localStorage.getItem('token')
        : null;

    const base = import.meta.env.VITE_API_BASE ?? '';
    const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${base}${downloadUrl}`;

    const res = await fetch(fullUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      throw new Error(`Download failed with HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = filenameSuffix ? `_${filenameSuffix}` : '';
    a.download = `Attendance_Register${suffix}_${dateStr}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
  };

  const startPolling = useCallback(
    (reportId: string, params?: ReportDownloadParams) => {
      stopPolling();
      setState('building');
      startTimeRef.current = Date.now();

      const base = import.meta.env.VITE_API_BASE ?? '';
      const token =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('access_token') || localStorage.getItem('token')
          : null;

      pollIntervalRef.current = window.setInterval(async () => {
        if (Date.now() - startTimeRef.current > 60000) {
          stopPolling();
          setState('idle');
          setToast({ message: 'Report service slow — retry', type: 'error' });
          params?.onError?.(new Error('Report generation timed out'));
          return;
        }

        try {
          const res = await fetch(`${base}/api/v1/reports/${reportId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });

          if (!res.ok) {
            throw new Error(`Poll failed with HTTP ${res.status}`);
          }

          const data = await res.json();

          if (data.status === 'ready') {
            stopPolling();
            const targetUrl = data.download_url || `/api/v1/reports/download/${reportId}`;
            await handleDownloadFile(targetUrl, params?.session_id ? `Session_${params.session_id}` : undefined);

            queryClient.invalidateQueries({ queryKey: keys.reports.all() });
            setToast({ message: 'Register downloaded', type: 'success' });
            setState('idle');
            params?.onSuccess?.();
            defaultParams?.onSuccess?.();
          } else if (data.status === 'failed') {
            stopPolling();
            setState('idle');
            setToast({
              message: data.error || 'Report generation failed',
              type: 'error',
            });
            params?.onError?.(new Error(data.error || 'Report generation failed'));
          }
        } catch (err: any) {
          stopPolling();
          setState('idle');
          setToast({
            message: err?.message || 'Report generation failed — retry',
            type: 'error',
          });
          params?.onError?.(err);
        }
      }, 2000);
    },
    [defaultParams, queryClient, stopPolling]
  );

  const downloadReport = useCallback(
    async (overrideParams?: ReportDownloadParams) => {
      if (state !== 'idle') return;

      const merged = { ...defaultParams, ...overrideParams };
      setState('requesting');
      const base = import.meta.env.VITE_API_BASE ?? '';
      const token =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('access_token') || localStorage.getItem('token')
          : null;

      try {
        const bodyPayload: Record<string, any> = {
          type: merged.type || 'register',
          range: merged.range || 'week',
          format: merged.format || 'xlsx',
        };
        if (merged.session_id) {
          bodyPayload.session_id = merged.session_id;
        }

        const res = await fetch(`${base}/api/v1/reports/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(bodyPayload),
        });

        if (!res.ok) {
          throw new Error(`Report request failed with HTTP ${res.status}`);
        }

        const data = await res.json();
        const reportId = data.id;

        if (!reportId) {
          throw new Error('Invalid response from report service');
        }

        if (data.status === 'ready') {
          const targetUrl = data.download_url || `/api/v1/reports/download/${reportId}`;
          await handleDownloadFile(targetUrl, merged.session_id ? `Session_${merged.session_id}` : undefined);
          queryClient.invalidateQueries({ queryKey: keys.reports.all() });
          setToast({ message: 'Register downloaded', type: 'success' });
          setState('idle');
          merged.onSuccess?.();
          defaultParams?.onSuccess?.();
        } else {
          startPolling(reportId, merged);
        }
      } catch (err: any) {
        setState('idle');
        setToast({
          message: err?.message || 'Failed to request report',
          type: 'error',
        });
        merged.onError?.(err);
      }
    },
    [defaultParams, queryClient, startPolling, state]
  );

  return {
    downloadReport,
    state,
    isDownloading: state !== 'idle',
    toast,
    clearToast: () => setToast(null),
  };
};

