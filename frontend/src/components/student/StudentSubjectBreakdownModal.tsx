import React from 'react';
import { BookOpen, X, AlertTriangle } from 'lucide-react';

interface StudentSubjectBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  compliance: any;
  summary: any;
}

export const StudentSubjectBreakdownModal: React.FC<StudentSubjectBreakdownModalProps> = ({
  isOpen,
  onClose,
  compliance,
  summary,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 max-w-lg w-full space-y-4 border border-[#D2D2D7] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center pb-3 border-b border-[#D2D2D7]">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#3a5f94]" />
            <h3 className="font-bold text-base text-[#001e40]">Subject Attendance Breakdown</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-[#737780] hover:text-[#001e40] p-1 rounded-full hover:bg-[#F5F5F7]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {compliance?.courses && compliance.courses.length > 0 ? (
            compliance.courses.map((course: any, idx: number) => {
              const pct = course.attendance_percentage;
              const isInsufficient = course.band === 'INSUFFICIENT_DATA';
              const isEligible = course.band === 'ELIGIBLE';
              const isCondonable = course.band === 'CONDONABLE';
              const barColor = isEligible ? 'bg-[#34C759]' : isCondonable ? 'bg-[#FF9F0A]' : isInsufficient ? 'bg-[#2f53d7]' : 'bg-[#E22126]';
              return (
                <div 
                  key={idx} 
                  className="p-3.5 bg-[#F5F5F7] rounded-2xl border border-[#D2D2D7] space-y-2 shadow-xs"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="px-2 py-0.5 rounded bg-[#001e40] text-white font-mono text-[10px] font-bold">
                          {course.course_code}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 uppercase">
                          {course.course_type}
                        </span>
                      </div>
                      <h4 className="font-bold text-sm text-[#001e40]">{course.course_name}</h4>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`font-mono font-black text-xs px-2 py-0.5 rounded block ${
                        isEligible ? 'bg-[#34C759]/10 text-[#34C759]' : isCondonable ? 'bg-[#FF9F0A]/10 text-[#FF9F0A]' : isInsufficient ? 'bg-blue-50 text-blue-700' : 'bg-[#E22126]/10 text-[#E22126]'
                      }`}>
                        {course.display_percentage}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        {isInsufficient ? 'Initial Data' : course.band}
                      </span>
                    </div>
                  </div>

                  <div className="w-full bg-[#E5E5EA] h-2 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${barColor} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-[11px] text-[#5e5e63]">
                    <span>
                      Attended: <strong>{course.present_sessions}</strong> / {course.effective_sessions} classes
                      {course.approved_absences_count > 0 && ` (${course.approved_absences_count} excused)`}
                    </span>
                    <span className="font-bold text-[#001e40] hover:underline flex items-center gap-1">
                      Audit Sessions &rarr;
                    </span>
                  </div>

                  {!isEligible && !isInsufficient && course.projected_classes_needed > 0 && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-xl text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Attend {course.projected_classes_needed} more consecutive classes to reach the 75% ELIGIBLE band.</span>
                    </div>
                  )}
                </div>
              );
            })
          ) : summary?.subjects && summary.subjects.length > 0 ? (
            summary.subjects.map((subj: any, idx: number) => {
              const pct = subj.percentage ?? 0;
              const isGood = pct >= 75;
              const isWarn = pct >= 65 && pct < 75;
              const barColor = isGood ? 'bg-[#34C759]' : isWarn ? 'bg-[#FF9F0A]' : 'bg-[#E22126]';
              return (
                <div key={idx} className="p-3.5 bg-[#F5F5F7] rounded-xl border border-[#D2D2D7]">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-bold text-sm text-[#001e40]">{subj.subject_name}</span>
                    <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                      isGood ? 'bg-[#34C759]/10 text-[#34C759]' : isWarn ? 'bg-[#FF9F0A]/10 text-[#FF9F0A]' : 'bg-[#E22126]/10 text-[#E22126]'
                    }`}>
                      {pct}%
                    </span>
                  </div>
                  <div className="w-full bg-[#E5E5EA] h-2 rounded-full overflow-hidden mb-1.5">
                    <div 
                      className={`h-full ${barColor} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-[#5e5e63]">
                    <span>Attended: <strong>{subj.present}</strong> / {subj.conducted}</span>
                    <span>{isGood ? 'Eligible for Exams' : `${75 - pct > 0 ? (75 - pct).toFixed(1) : 0}% short`}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-6 text-[#5e5e63] text-sm">
              No subject records found.
            </div>
          )}
        </div>

        <div className="pt-2 flex justify-end">
          <button 
            onClick={onClose}
            className="w-full py-2.5 bg-[#001e40] text-white font-bold text-xs rounded-xl hover:bg-[#003366] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
