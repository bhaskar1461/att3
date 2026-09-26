import React from 'react';
import { Lock, X } from 'lucide-react';

interface ProjectorSessionEndedOverlayProps {
  sessionId: number;
  data: any;
  onClose: () => void;
}

export const ProjectorSessionEndedOverlay: React.FC<ProjectorSessionEndedOverlayProps> = ({
  sessionId,
  data,
  onClose,
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950 text-white select-none z-40">
      <div className="w-24 h-24 rounded-3xl bg-rose-500/10 border-2 border-rose-500/40 flex items-center justify-center mb-6 shadow-2xl animate-pulse">
        <Lock className="w-12 h-12 text-rose-400" />
      </div>
      <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight uppercase mb-4">
        SESSION ENDED
      </h1>
      <p className="text-lg sm:text-2xl font-bold text-rose-300 max-w-xl mb-4">
        No further scans are accepted. Attendance window has closed.
      </p>
      <p className="text-sm text-slate-400 max-w-md mb-8">
        This class session has been locked by the instructor. See your faculty if you require manual attendance reconciliation.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 text-slate-300 font-mono text-xs sm:text-sm bg-white/5 px-6 py-3 rounded-xl border border-white/10 mb-8">
        <span>Session #{sessionId}</span>
        <span>•</span>
        <span>{data?.subject_name || 'Class'}</span>
        <span>•</span>
        <span>{data?.section_name || 'Section'}</span>
        <span>•</span>
        <span>{data?.session_date || 'Today'}</span>
      </div>
      <button
        onClick={onClose}
        className="px-8 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl text-sm transition shadow-2xl flex items-center gap-2"
      >
        <X className="w-4 h-4" />
        <span>Close Projector Screen</span>
      </button>
    </div>
  );
};
