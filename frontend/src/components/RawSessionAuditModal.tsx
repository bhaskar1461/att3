import React, { useState, useEffect } from 'react';
import { 
  X, ShieldCheck, CheckCircle, XCircle, AlertTriangle, 
  Clock, Calendar, BookOpen, User, RefreshCw, FileText, Award
} from 'lucide-react';
import { apiRequest } from '../services/api';

interface RawSessionItem {
  session_id: number;
  date: string;
  period_count: number;
  start_time: string | null;
  status: 'PRESENT' | 'ABSENT' | 'APPROVED_ABSENCE';
  is_approved_absence: boolean;
  approved_absence_reason: string | null;
  marked_at: string | null;
  scan_mode: string | null;
}

interface CourseComplianceItem {
  course_id: number;
  course_name: string;
  course_code: string;
  course_type: string;
  effective_sessions: number;
  present_sessions: number;
  approved_absences_count: number;
  attendance_percentage: number | null;
  display_percentage: string;
  band: 'ELIGIBLE' | 'CONDONABLE' | 'DETAINED';
  condonation_status: string;
  projected_classes_needed: number;
  sessions: RawSessionItem[];
}

interface StudentComplianceResponse {
  student_id: number;
  roll_number: string;
  name: string;
  join_date: string | null;
  courses: CourseComplianceItem[];
  aggregate: {
    total_effective_sessions: number;
    total_present_sessions: number;
    aggregate_percentage: number | null;
    aggregate_display: string;
    band: 'ELIGIBLE' | 'CONDONABLE' | 'DETAINED';
    condonation_status: string;
    courses_below_75_count: number;
    projected_classes_needed_aggregate: number;
  };
}

interface RawSessionAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  rollNumber: string;
  initialCourseId?: number | null;
}

export const RawSessionAuditModal: React.FC<RawSessionAuditModalProps> = ({
  isOpen,
  onClose,
  rollNumber,
  initialCourseId = null
}) => {
  const [data, setData] = useState<StudentComplianceResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(initialCourseId);

  useEffect(() => {
    if (!isOpen || !rollNumber) {
      setData(null);
      setError(null);
      return;
    }
    fetchCompliance();
  }, [isOpen, rollNumber]);

  useEffect(() => {
    if (initialCourseId) {
      setSelectedCourseId(initialCourseId);
    }
  }, [initialCourseId]);

  const fetchCompliance = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiRequest<StudentComplianceResponse>(`/analytics/student/${rollNumber}/attendance`);
      setData(res);
      if (!selectedCourseId && res.courses && res.courses.length > 0) {
        setSelectedCourseId(res.courses[0].course_id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load attendance compliance records.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentCourse = data?.courses.find(c => c.course_id === selectedCourseId) || data?.courses[0];

  const getBandBadge = (band: string) => {
    switch (band) {
      case 'ELIGIBLE':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> ELIGIBLE (&ge;75%)
          </span>
        );
      case 'CONDONABLE':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> CONDONABLE (65&ndash;74%)
          </span>
        );
      case 'DETAINED':
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5 text-rose-600" /> DETAINED (&lt;65%)
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#001e40] to-[#15347e] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20">
              <ShieldCheck className="w-6 h-6 text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base sm:text-lg">JNTUH R25 Attendance Audit Trail</h3>
                <span className="px-2 py-0.5 rounded bg-white/20 text-xs font-mono font-bold">
                  {rollNumber}
                </span>
              </div>
              <p className="text-xs text-blue-200">
                {data?.name ? `${data.name} • Sreenidhi Institute of Science & Technology` : 'Server-Authoritative Session Log'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-blue-200 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {isLoading && (
            <div className="py-20 flex flex-col items-center justify-center text-slate-500 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-[#2f53d7]" />
              <p className="text-sm font-semibold">Computing JNTUH R25 bands and raw session registers...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-sm flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {!isLoading && data && (
            <>
              {/* Aggregate KPI Banner */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="text-center px-4 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Aggregate Standing</span>
                    <span className="text-2xl font-black font-mono text-[#001e40]">
                      {data.aggregate.aggregate_display}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {getBandBadge(data.aggregate.band)}
                      {data.aggregate.band === 'CONDONABLE' && (
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          Fine Status: <strong className="uppercase">{data.aggregate.condonation_status}</strong>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">
                      Total Attended: <b>{data.aggregate.total_present_sessions}</b> of <b>{data.aggregate.total_effective_sessions}</b> effective conducted classes
                      {data.join_date && <span className="ml-2 font-mono text-blue-600 font-bold">(Joined: {data.join_date})</span>}
                    </p>
                  </div>
                </div>

                {data.aggregate.courses_below_75_count > 0 && (
                  <div className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
                    ⚠️ {data.aggregate.courses_below_75_count} Course(s) Below 75% Threshold
                  </div>
                )}
              </div>

              {/* Course Selector Tabs */}
              <div>
                <span className="text-xs font-extrabold text-slate-600 uppercase tracking-wider block mb-2">
                  Select Course to Audit:
                </span>
                <div className="flex flex-wrap gap-2">
                  {data.courses.map(course => {
                    const isSelected = course.course_id === currentCourse?.course_id;
                    const isBelow = (course.attendance_percentage ?? 0) < 75;
                    return (
                      <button
                        key={course.course_id}
                        onClick={() => setSelectedCourseId(course.course_id)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 border ${
                          isSelected
                            ? 'bg-[#001e40] text-white border-[#001e40] shadow-md'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>{course.course_code}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                          isSelected 
                            ? 'bg-white/20 text-white' 
                            : isBelow ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {course.display_percentage}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Course Audit Card */}
              {currentCourse && (
                <div className="border border-slate-200 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-100 text-[#001e40] font-mono text-xs font-bold rounded">
                          {currentCourse.course_code}
                        </span>
                        <h4 className="font-extrabold text-base text-[#001e40]">{currentCourse.course_name}</h4>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Category: <b>{currentCourse.course_type}</b> • Present: <b>{currentCourse.present_sessions}</b> / Conducted: <b>{currentCourse.effective_sessions}</b>
                        {currentCourse.approved_absences_count > 0 && (
                          <span className="text-blue-600 font-bold ml-2">
                            ({currentCourse.approved_absences_count} Approved Absences Excluded)
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {getBandBadge(currentCourse.band)}
                      <span className="text-xl font-black font-mono text-slate-800">
                        {currentCourse.display_percentage}
                      </span>
                    </div>
                  </div>

                  {/* Projected Classes Needed Callout */}
                  {currentCourse.band !== 'ELIGIBLE' && currentCourse.projected_classes_needed > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-900 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        Projected classes needed: You need <u>{currentCourse.projected_classes_needed}</u> more consecutive classes to reach 75% in this course.
                      </span>
                    </div>
                  )}

                  {/* Raw Session Records Table */}
                  <div>
                    <h5 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-slate-500" />
                      Auditable Session Registry ({currentCourse.sessions.length} sessions logged)
                    </h5>

                    {currentCourse.sessions.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                        Zero sessions conducted for this course yet (JNTUH Band: &mdash;).
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-72">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100 text-slate-600 uppercase font-bold sticky top-0 border-b border-slate-200">
                            <tr>
                              <th className="px-3.5 py-2.5">Date</th>
                              <th className="px-3.5 py-2.5">Periods</th>
                              <th className="px-3.5 py-2.5">Status</th>
                              <th className="px-3.5 py-2.5">Mode</th>
                              <th className="px-3.5 py-2.5">IST Timestamp</th>
                              <th className="px-3.5 py-2.5">Remarks / Reason</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {currentCourse.sessions.map((sess, sIdx) => {
                              const isPres = sess.status === 'PRESENT';
                              const isAppr = sess.status === 'APPROVED_ABSENCE';
                              return (
                                <tr key={sIdx} className="hover:bg-slate-50 transition">
                                  <td className="px-3.5 py-2.5 font-mono font-medium text-slate-800">
                                    {sess.date}
                                  </td>
                                  <td className="px-3.5 py-2.5 font-bold text-slate-700">
                                    {sess.period_count} Period(s)
                                  </td>
                                  <td className="px-3.5 py-2.5">
                                    {isPres ? (
                                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[11px] inline-flex items-center gap-1">
                                        <CheckCircle className="w-3 h-3 text-emerald-600" /> Present
                                      </span>
                                    ) : isAppr ? (
                                      <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold text-[11px] inline-flex items-center gap-1">
                                        <Award className="w-3 h-3 text-sky-600" /> Approved Absence
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[11px] inline-flex items-center gap-1">
                                        <XCircle className="w-3 h-3 text-rose-600" /> Absent
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3.5 py-2.5 font-mono text-slate-500">
                                    {sess.scan_mode || 'QR'}
                                  </td>
                                  <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-500">
                                    {sess.marked_at ? sess.marked_at.slice(11, 19) : (isPres ? 'Recorded' : '&mdash;')}
                                  </td>
                                  <td className="px-3.5 py-2.5 text-slate-600">
                                    {sess.approved_absence_reason ? (
                                      <span className="text-sky-700 font-medium">{sess.approved_absence_reason}</span>
                                    ) : isPres ? (
                                      <span className="text-emerald-700 font-medium">Session credit verified</span>
                                    ) : (
                                      <span className="text-slate-400">Unexcused absence</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>JNTUH R25 Compliance Rule: Approved absences excluded from denominator.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#001e40] text-white font-bold rounded-xl hover:bg-[#003366] transition"
          >
            Close Audit Trail
          </button>
        </div>

      </div>
    </div>
  );
};
