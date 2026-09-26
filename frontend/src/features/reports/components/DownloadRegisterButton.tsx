import React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/Toast';
import { useReportDownload } from '../hooks';

export interface DownloadRegisterButtonProps {
  className?: string;
  onSuccess?: () => void;
}

export const DownloadRegisterButton: React.FC<DownloadRegisterButtonProps> = ({
  className = '',
  onSuccess,
}) => {
  const { downloadReport, state, isDownloading, toast, clearToast } = useReportDownload({
    type: 'register',
    range: 'week',
    format: 'xlsx',
    onSuccess,
  });

  const getButtonText = () => {
    switch (state) {
      case 'requesting':
        return 'Requesting...';
      case 'building':
        return 'Building...';
      case 'idle':
      default:
        return 'Download weekly register';
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={isDownloading}
        onClick={() => downloadReport()}
        className={`w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-xl border border-indigo-500/20 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 transition-all shadow-sm ${className}`}
      >
        {isDownloading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          <Download className="w-3.5 h-3.5 shrink-0" />
        )}
        <span>{getButtonText()}</span>
      </Button>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={clearToast}
        />
      )}
    </>
  );
};
