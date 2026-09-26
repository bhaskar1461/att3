import React from 'react';
import { Info, AlertOctagon, Sparkles } from 'lucide-react';

interface StudentComplianceAlertBannerProps {
  isInsufficientData: boolean;
  hasConducted: boolean;
  compAgg: any;
  unrecoverableCourse: any;
  primaryRecoveryCourse: any;
  overallPercent: number;
  aggClassesNeeded: number;
  isAggRecoverable: boolean;
  displayOverall: string;
}

export const StudentComplianceAlertBanner: React.FC<StudentComplianceAlertBannerProps> = ({
  isInsufficientData,
  hasConducted,
  compAgg,
  unrecoverableCourse,
  primaryRecoveryCourse,
  overallPercent,
  aggClassesNeeded,
  isAggRecoverable,
  displayOverall,
}) => {
  if (isInsufficientData) {
    return (
      <div className="rounded-2xl p-4 bg-gradient-to-r from-[#001e40] via-[#093268] to-[#15347e] text-white border border-blue-400/30 shadow-md flex items-start gap-3.5">
        <Info className="w-6 h-6 text-blue-300 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-black text-sm text-white">Semester Underway: Classes in Progress</h4>
            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-200 font-mono text-[10px] font-bold border border-blue-400/30">
              Orientation Phase
            </span>
          </div>
          <p className="text-xs text-blue-100 mt-1 leading-relaxed">
            Only {compAgg?.total_effective_sessions ?? 0} session(s) conducted so far. JNTUH compliance bands and defaulter evaluation activate after 3 sessions to prevent premature detention flags.
          </p>
        </div>
      </div>
    );
  }

  if (hasConducted && unrecoverableCourse) {
    return (
      <div className="rounded-2xl p-4 bg-gradient-to-r from-rose-950 via-rose-900 to-[#1b1b1d] text-white border border-rose-500/40 shadow-md flex items-start gap-3.5">
        <AlertOctagon className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-black text-sm text-white">
              Detention Risk Alert: {unrecoverableCourse.course_name} ({unrecoverableCourse.course_code})
            </h4>
            <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono text-[10px] font-bold border border-rose-500/40">
              Not Recoverable
            </span>
          </div>
          <p className="text-xs text-rose-100/90 mt-1 leading-relaxed">
            With {unrecoverableCourse.sessions_remaining} classes remaining, your attendance can reach at most {unrecoverableCourse.max_possible_percentage?.toFixed(1) || unrecoverableCourse.projected_percentage?.toFixed(1)}% (below the 75% requirement). Please consult your academic counselor or HOD immediately to initiate the condonation review process.
          </p>
        </div>
      </div>
    );
  }

  if (hasConducted && primaryRecoveryCourse) {
    return (
      <div className="rounded-2xl p-4 bg-gradient-to-r from-[#001e40] via-[#093268] to-[#15347e] text-white border border-blue-400/30 shadow-md flex items-start gap-3.5">
        <Sparkles className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-black text-sm text-white">
              Attendance Recovery Path: Attend {primaryRecoveryCourse.classes_needed || primaryRecoveryCourse.projected_classes_needed} more consecutive classes in {primaryRecoveryCourse.course_code}
            </h4>
            <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-400/30">
              Target: 75%
            </span>
          </div>
          <p className="text-xs text-blue-100 mt-1 leading-relaxed">
            You are currently at {primaryRecoveryCourse.display_percentage || `${primaryRecoveryCourse.attendance_percentage}%`}. Attending {primaryRecoveryCourse.classes_needed || primaryRecoveryCourse.projected_classes_needed} consecutive upcoming classes will bring you back into the compliant ELIGIBLE band.
          </p>
        </div>
      </div>
    );
  }

  if (hasConducted && overallPercent < 75 && aggClassesNeeded > 0 && isAggRecoverable) {
    return (
      <div className="rounded-2xl p-4 bg-gradient-to-r from-[#001e40] via-[#093268] to-[#15347e] text-white border border-blue-400/30 shadow-md flex items-start gap-3.5">
        <Sparkles className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-black text-sm text-white">
              Attendance Recovery Path: Attend {aggClassesNeeded} more classes overall
            </h4>
            <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-400/30">
              Target: 75%
            </span>
          </div>
          <p className="text-xs text-blue-100 mt-1 leading-relaxed">
            Your overall semester attendance is currently {displayOverall}. Attending {aggClassesNeeded} more consecutive sessions will restore compliance.
          </p>
        </div>
      </div>
    );
  }

  return null;
};
