import React, { useState, useRef, useEffect } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/Toast';
import { keys } from '../../../core/api/keys';

export type DownloadState = 'idle' | 'requesting' | 'building';

export interface DownloadRegisterButtonProps {
  className?: string;
  onSuccess?: () => void;
}

export const DownloadRegisterButton: React.FC<DownloadRegisterButtonProps> = ({
  className = '',
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<DownloadState>('idle');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const pollIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const stopPolling = () => {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleDownloadFile = async (downloadUrl: string) => {
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
    a.download = `Attendance_Register_Weekly_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
  };

  const startPolling = (reportId: string) => {
    stopPolling();
    setState('building');
    startTimeRef.current = Date.now();

    const base = import.meta.env.VITE_API_BASE ?? '';
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('access_token') || localStorage.getItem('token')
        : null;

    pollIntervalRef.current = window.setInterval(async () => {
      // 60-second timeout check
      if (Date.now() - startTimeRef.current > 60000) {
        stopPolling();
        setState('idle');
        setToast({ message: 'Report service slow — retry', type: 'error' });
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
          await handleDownloadFile(targetUrl);

          queryClient.invalidateQueries({ queryKey: keys.reports.all() });
          setToast({ message: 'Register downloaded', type: 'success' });
          setState('idle');
          onSuccess?.();
        } else if (data.status === 'failed') {
          stopPolling();
          setState('idle');
          setToast({
            message: data.error || 'Report generation failed',
            type: 'error',
          });
        }
      } catch (err: any) {
        // Backend aborted/killed mid-building or network drop
        stopPolling();
        setState('idle');
        setToast({
          message: err?.message || 'Report generation failed — retry',
          type: 'error',
        });
      }
    }, 2000);
  };

  const handleStartRequest = async () => {
    if (state !== 'idle') return;

    setState('requesting');
    const base = import.meta.env.VITE_API_BASE ?? '';
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('access_token') || localStorage.getItem('token')
        : null;

    try {
      const res = await fetch(`${base}/api/v1/reports/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: 'register',
          range: 'week',
          format: 'xlsx',
        }),
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
        await handleDownloadFile(targetUrl);
        queryClient.invalidateQueries({ queryKey: keys.reports.all() });
        setToast({ message: 'Register downloaded', type: 'success' });
        setState('idle');
        onSuccess?.();
      } else {
        startPolling(reportId);
      }
    } catch (err: any) {
      setState('idle');
      setToast({
        message: err?.message || 'Failed to request report',
        type: 'error',
      });
    }
  };

  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <Button
        type="button"
        size="sm"
        disabled={state !== 'idle'}
        onClick={handleStartRequest}
        className={`h-7 px-3 text-[11px] font-semibold gap-1.5 rounded-md ${className}`}
        aria-label={
          state === 'requesting'
            ? 'Requesting register report'
            : state === 'building'
            ? 'Building register report'
            : 'Download weekly register'
        }
      >
        {state === 'requesting' ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span>Requesting…</span>
          </>
        ) : state === 'building' ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span>Building…</span>
          </>
        ) : (
          <>
            <Download className="w-3 h-3 shrink-0" />
            <span>Download</span>
          </>
        )}
      </Button>
    </>
  );
};
