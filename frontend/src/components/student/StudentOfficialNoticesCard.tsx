import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface StudentOfficialNoticesCardProps {
  warnings: any[];
}

export const StudentOfficialNoticesCard: React.FC<StudentOfficialNoticesCardProps> = ({ warnings }) => {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="col-span-1 md:col-span-12 bg-white rounded-2xl p-6 border border-[#D2D2D7] shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
        <h3 className="font-bold text-base text-[#001e40] flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          Official Attendance Notices & Recovery Guidance ({warnings.length})
        </h3>
        <span className="text-[11px] font-medium text-slate-500">
          Institutional record preserved at time of notice
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {warnings.map((w: any, wIdx: number) => (
          <div key={w.id || wIdx} className="p-4 rounded-xl bg-[#F5F5F7] border border-[#D2D2D7] space-y-2.5">
            <div className="flex justify-between items-start gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#001e40] text-white uppercase">
                {(w.warning_type || 'WARNING').replace(/_/g, ' ')}
              </span>
              <span className="text-[11px] font-mono text-slate-500 font-semibold">
                📅 {w.issued_at ? new Date(w.issued_at).toLocaleDateString('en-IN') : 'Recent'}
              </span>
            </div>
            <div className="text-xs font-bold text-slate-900">
              Course: {w.course_name || w.course_code || 'Semester Overall'}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 font-bold border border-rose-200 text-[11px]">
                Snapshot: {w.percentage_at_issue}% ({w.band_at_issue})
              </span>
              <span className="text-slate-700 text-[11px] font-bold">
                {w.classes_needed_at_issue > 0 
                  ? `Action: Needed ${w.classes_needed_at_issue} consecutive classes`
                  : 'Action: Contact Counselor'}
              </span>
            </div>
            {w.message && (
              <p className="text-xs text-slate-700 italic bg-white p-2.5 rounded-lg border border-[#D2D2D7] mt-1">
                "{w.message}"
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
