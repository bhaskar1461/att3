import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 4000 }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const styles = {
    success: 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200 shadow-emerald-900/20',
    error: 'bg-rose-950/90 border-rose-500/50 text-rose-200 shadow-rose-900/20',
    warning: 'bg-amber-950/90 border-amber-500/50 text-amber-200 shadow-amber-900/20',
    info: 'bg-cyan-950/90 border-cyan-500/50 text-cyan-200 shadow-cyan-900/20',
  }[type];

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
    error: <XCircle className="w-5 h-5 text-rose-400 shrink-0" />,
    warning: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
    info: <Info className="w-5 h-5 text-cyan-400 shrink-0" />,
  }[type];

  return (
    <div className={`fixed top-4 md:top-auto md:bottom-5 right-4 left-4 md:left-auto md:w-96 z-50 flex items-center justify-between gap-3 p-4 rounded-xl border backdrop-blur-md shadow-xl transition-all animate-bounce-in ${styles}`}>
      <div className="flex items-center gap-3">
        {icons}
        <p className="text-sm font-medium leading-tight">{message}</p>
      </div>
      <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
        <X className="w-4 h-4 text-slate-400 hover:text-white" />
      </button>
    </div>
  );
};
