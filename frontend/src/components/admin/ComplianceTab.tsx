import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, AlertTriangle, XCircle, CheckCircle, RefreshCw, 
  Users, Building2, Search, Edit3, DollarSign, ArrowRight, ExternalLink,
  TrendingDown, AlertOctagon, Mail, Send, Check, Clock, ShieldAlert, FileSpreadsheet
} from 'lucide-react';
import { apiRequest } from '../../services/api';

interface DepartmentComplianceItem {
  department_name: string;
  department_code: string;
  total_students: number;
  eligible_count: number;
  condonable_count: number;
  detained_count: number;
  eligible_pct: number;
  condonable_pct: number;
  detained_pct: number;
}

interface ComplianceSummaryResponse {
  total_students: number;
  overall_eligible: number;
  overall_condonable: number;
  overall_detained: number;
  thresholds: {
    eligible: number;
    condonable: number;
  };
  departments: DepartmentComplianceItem[];
}

interface DefaulterRow {
  student_id: number;
  roll_number: string;
  name: string;
  course_id: number;
  course_code: string;
  course_name: string;
  current_percentage: number;
  current_band: 'ELIGIBLE' | 'CONDONABLE' | 'DETAINED';
  sessions_held: number;
  sessions_present: number;
  sessions_remaining: number;
  projected_percentage: number;
  max_possible_percentage: number;
  classes_needed: number;
  is_recoverable: boolean;
  recovery_status: 'RECOVERABLE' | 'NOT_RECOVERABLE';
  recovery_message: string;
  rapid_decline: boolean;
  active_warning_count: number;
  condonation_status?: string;
  fine_amount?: number;
}

interface ComplianceTabProps {
  onOpenDepartmentDrilldown?: (deptCode?: string) => void;
}

export const ComplianceTab: React.FC<ComplianceTabProps> = ({ onOpenDepartmentDrilldown }) => {
  const [data, setData] = useState<ComplianceSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Watchlists State
  const [watchlistTab, setWatchlistTab] = useState<'rapid_decline' | 'not_recoverable' | 'condonable'>('rapid_decline');
  const [allDefaulters, setAllDefaulters] = useState<DefaulterRow[]>([]);
  const [isWatchlistLoading, setIsWatchlistLoading] = useState<boolean>(false);

  // Condonation inline edit state
  const [condonationFeedback, setCondonationFeedback] = useState<{ msg: string; success: boolean } | null>(null);
  const [updatingStudentRoll, setUpdatingStudentRoll] = useState<string | null>(null);

  // Weekly Digest Trigger State
  const [isTriggeringDigest, setIsTriggeringDigest] = useState<boolean>(false);
  const [digestResult, setDigestResult] = useState<{ msg: string; success: boolean } | null>(null);

  useEffect(() => {
    fetchComplianceSummary();
    fetchDefaulterWatchlists();
  }, []);

  const fetchComplianceSummary = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiRequest<ComplianceSummaryResponse>('/admin/analytics/attendance-summary');
      setData(res);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to load JNTUH R25 compliance summary.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDefaulterWatchlists = async () => {
    setIsWatchlistLoading(true);
    try {
      const res = await apiRequest<{ status: string; students: DefaulterRow[] }>('/admin/defaulters?band=ALL');
      setAllDefaulters(res.students || []);
    } catch (err: any) {
      console.warn('Could not load defaulter watchlists:', err);
    } finally {
      setIsWatchlistLoading(false);
    }
  };

  const rapidDeclineList = allDefaulters.filter(s => s.rapid_decline);
  const notRecoverableList = allDefaulters.filter(s => !s.is_recoverable && s.current_percentage < 75);
  const condonableList = allDefaulters.filter(s => s.current_band === 'CONDONABLE' || s.current_percentage >= 65 && s.current_percentage < 75);

  const handleUpdateCondonationStatus = async (rollNumber: string, status: string, fine: number, remarks: string) => {
    setUpdatingStudentRoll(rollNumber);
    setCondonationFeedback(null);
    try {
      await apiRequest(`/compliance/condonations/${rollNumber}`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          fine_amount: fine,
          remarks
        })
      });
      setCondonationFeedback({ 
        msg: `Condonation status for ${rollNumber} updated to '${status.toUpperCase()}'.`, 
        success: true 
      });
      fetchComplianceSummary();
      fetchDefaulterWatchlists();
    } catch (err: any) {
      setCondonationFeedback({ 
        msg: err.message || 'Failed to update student condonation status.', 
        success: false 
      });
    } finally {
      setUpdatingStudentRoll(null);
    }
  };

  const handleTriggerHODDigest = async () => {
    setIsTriggeringDigest(true);
    setDigestResult(null);
    try {
      const res = await apiRequest<any>('/admin/defaulters/hod-digest', {
        method: 'POST'
      });
      setDigestResult({
        msg: `Weekly HOD Digest: ${res.total_dispatched} dispatched, ${res.total_skipped} skipped (idempotent).`,
        success: true
      });
    } catch (err: any) {
      setDigestResult({
        msg: err.message || 'Failed to trigger weekly HOD digest.',
        success: false
      });
    } finally {
      setIsTriggeringDigest(false);
    }
  };

  if (isLoading) {
    return (
      <div className="snist-card p-12 flex flex-col items-center justify-center text-slate-500 space-y-3">
        <RefreshCw className="w-8 h-8 animate-spin text-[#2f53d7]" />
        <p className="text-sm font-semibold">Analyzing college-wide JNTUH R25 attendance bands...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="snist-card p-6 bg-rose-50 border border-rose-200 text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold text-sm">
          <AlertTriangle className="w-5 h-5 text-rose-600" />
          <span>Error Loading Compliance Data</span>
        </div>
        <p className="text-xs">{error || 'Unknown error occurred.'}</p>
        <button
          onClick={fetchComplianceSummary}
          className="px-4 py-2 bg-rose-600 text-white font-bold text-xs rounded-xl"
        >
          Retry
        </button>
      </div>
    );
  }

  const eligibleShare = data.total_students > 0 ? Math.round((data.overall_eligible / data.total_students) * 100) : 0;
  const condonableShare = data.total_students > 0 ? Math.round((data.overall_condonable / data.total_students) * 100) : 0;
  const detainedShare = data.total_students > 0 ? Math.round((data.overall_detained / data.total_students) * 100) : 0;
  const totalDefaulters = data.overall_condonable + data.overall_detained;
  const defaulterShare = data.total_students > 0 ? Math.round((totalDefaulters / data.total_students) * 100) : 0;

  return (
    <div className="space-y-8 animate-fadeIn">
      
      {/* Overview KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        
        {/* Card 1: Total Enrolled */}
        <div className="snist-card p-6 space-y-2 border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#6a7894] uppercase tracking-wider">Total Enrolled</span>
            <div className="w-8 h-8 rounded-lg bg-[#2f53d7]/10 flex items-center justify-center text-[#2f53d7]">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="font-heading text-3xl font-extrabold text-[#15347e]">{data.total_students}</p>
          <span className="text-xs text-slate-500 font-medium">Across 7 SNIST Departments</span>
        </div>

        {/* Card 2: Eligible */}
        <div className="snist-card p-6 space-y-2 border-emerald-200 bg-emerald-50/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Eligible (&ge;75%)</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-600/10 flex items-center justify-center text-emerald-600">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="font-heading text-3xl font-extrabold text-emerald-700">{data.overall_eligible}</p>
          <span className="text-xs font-bold text-emerald-700">{eligibleShare}% of Enrolled Students</span>
        </div>

        {/* Card 3: Condonable */}
        <div className="snist-card p-6 space-y-2 border-amber-200 bg-amber-50/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Condonable (65&ndash;74%)</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="font-heading text-3xl font-extrabold text-amber-700">{data.overall_condonable}</p>
          <span className="text-xs font-bold text-amber-700">{condonableShare}% • Fine Approval Tracked</span>
        </div>

        {/* Card 4: Detained */}
        <div className="snist-card p-6 space-y-2 border-rose-200 bg-rose-50/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-800 uppercase tracking-wider">Detained (&lt;65%)</span>
            <div className="w-8 h-8 rounded-lg bg-rose-600/10 flex items-center justify-center text-rose-600">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="font-heading text-3xl font-extrabold text-rose-700">{data.overall_detained}</p>
          <span className="text-xs font-bold text-rose-700">{detainedShare}% • Hard Regulatory Flag</span>
        </div>

      </div>

      {/* Operations Action Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#2f53d7] flex items-center justify-center font-bold">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Weekly HOD Compliance Digest</h4>
            <p className="text-[11px] text-slate-500 font-medium">
              Dispatches department summary, rapid decline cases, and detention list (150/hr rate-capped & idempotent).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {digestResult && (
            <span className={`text-xs font-bold px-3 py-1 rounded-lg ${
              digestResult.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}>
              {digestResult.msg}
            </span>
          )}
          <button
            onClick={handleTriggerHODDigest}
            disabled={isTriggeringDigest}
            className="px-4 py-2 bg-[#001e40] hover:bg-[#2f53d7] disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 shadow-sm"
          >
            {isTriggeringDigest ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Trigger Weekly Digest
          </button>
        </div>
      </div>

      {/* Department Compliance Summary Table with Defaulter Breakdown */}
      <div className="snist-card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#2f53d7]" />
              Department JNTUH R25 Standing Register
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Breakdown of student attendance bands and defaulter headcounts across departments.
            </p>
          </div>
          <button
            onClick={() => { fetchComplianceSummary(); fetchDefaulterWatchlists(); }}
            className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition flex items-center gap-1.5 w-fit"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh Analytics
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-100 text-slate-600 uppercase font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3 text-center">Total Students</th>
                <th className="px-4 py-3 text-center">Defaulters (&lt;75%)</th>
                <th className="px-4 py-3">Eligible (&ge;75%)</th>
                <th className="px-4 py-3">Condonable (65&ndash;74%)</th>
                <th className="px-4 py-3">Detained (&lt;65%)</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.departments.map((dept, dIdx) => {
                const deptDefaulters = dept.condonable_count + dept.detained_count;
                const deptDefaulterPct = dept.total_students > 0 ? Math.round((deptDefaulters / dept.total_students) * 100) : 0;

                return (
                  <tr key={dIdx} className="hover:bg-slate-50 transition">
                    
                    {/* Department Name & Code */}
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#2f53d7]/10 text-[#2f53d7] font-mono text-xs font-bold border border-[#2f53d7]/20">
                          {dept.department_code}
                        </span>
                        <span>{dept.department_name}</span>
                      </div>
                    </td>

                    {/* Total Students */}
                    <td className="px-4 py-3 text-center font-mono font-bold text-[#15347e]">
                      {dept.total_students}
                    </td>

                    {/* Defaulters Count Badge */}
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono font-bold border ${
                        deptDefaulters > 0 
                          ? 'bg-rose-50 text-rose-700 border-rose-300' 
                          : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      }`}>
                        {deptDefaulters > 0 ? `⚠️ ${deptDefaulters} (${deptDefaulterPct}%)` : '0 Clean'}
                      </span>
                    </td>

                    {/* Eligible */}
                    <td className="px-4 py-3">
                      <div className="space-y-1 min-w-[120px]">
                        <div className="flex justify-between font-bold text-[11px] text-emerald-800">
                          <span>{dept.eligible_count}</span>
                          <span>{dept.eligible_pct}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(dept.eligible_pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Condonable */}
                    <td className="px-4 py-3">
                      <div className="space-y-1 min-w-[120px]">
                        <div className="flex justify-between font-bold text-[11px] text-amber-800">
                          <span>{dept.condonable_count}</span>
                          <span>{dept.condonable_pct}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-amber-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(dept.condonable_pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Detained */}
                    <td className="px-4 py-3">
                      <div className="space-y-1 min-w-[120px]">
                        <div className="flex justify-between font-bold text-[11px] text-rose-800">
                          <span>{dept.detained_count}</span>
                          <span>{dept.detained_pct}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-rose-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(dept.detained_pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => onOpenDepartmentDrilldown?.(dept.department_code)}
                        className="px-3 py-1 bg-slate-100 hover:bg-[#2f53d7] hover:text-white rounded-lg font-bold text-[11px] text-[#2f53d7] border border-slate-200 transition flex items-center gap-1 mx-auto"
                      >
                        Roster <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Defaulter Watchlists & Trajectory Monitoring */}
      <div className="snist-card p-6 space-y-5">
        
        {/* Tab Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-3 gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#2f53d7]" />
            <h3 className="font-heading text-lg font-bold text-[#15347e]">
              Institutional Intervention & Trajectory Watchlists
            </h3>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setWatchlistTab('rapid_decline')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                watchlistTab === 'rapid_decline' 
                  ? 'bg-white text-rose-700 shadow-xs font-black' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              Rapid Decline ({rapidDeclineList.length})
            </button>

            <button
              onClick={() => setWatchlistTab('not_recoverable')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                watchlistTab === 'not_recoverable' 
                  ? 'bg-white text-purple-700 shadow-xs font-black' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              Not Recoverable ({notRecoverableList.length})
            </button>

            <button
              onClick={() => setWatchlistTab('condonable')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                watchlistTab === 'condonable' 
                  ? 'bg-white text-amber-700 shadow-xs font-black' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              Condonation Tracker ({condonableList.length})
            </button>
          </div>
        </div>

        {/* Watchlist Content */}
        {isWatchlistLoading ? (
          <div className="p-8 text-center flex flex-col items-center justify-center space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin text-[#2f53d7]" />
            <p className="text-xs font-bold text-slate-500">Loading intervention rosters...</p>
          </div>
        ) : watchlistTab === 'rapid_decline' ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 font-medium">
              Students whose attendance dropped &ge; 5% in each of the last two fortnights. Earliest indicator of attendance collapse.
            </p>
            {rapidDeclineList.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200 font-semibold text-xs">
                ✅ No students currently trigger the rapid decline alert threshold (&ge;5% drop across 2 fortnights).
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-rose-50 text-rose-900 font-bold uppercase border-b border-rose-200">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Course</th>
                      <th className="px-4 py-3 text-center">Current %</th>
                      <th className="px-4 py-3 text-center">Trend Signal</th>
                      <th className="px-4 py-3 text-center">Classes Needed</th>
                      <th className="px-4 py-3 text-center">Warnings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rapidDeclineList.map((s, idx) => (
                      <tr key={idx} className="hover:bg-rose-50/30 transition">
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-slate-900">{s.roll_number}</span>
                          <span className="block text-[11px] text-slate-500 font-medium">{s.name}</span>
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {s.course_code} - {s.course_name}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-mono font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                            {s.current_percentage.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-700 animate-pulse">
                            <TrendingDown className="w-3.5 h-3.5" /> Rapid Drop (&ge;5%)
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-slate-700">
                          {s.is_recoverable ? `${s.classes_needed} consecutive` : '⛔ Impossible'}
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-amber-700">
                          {s.active_warning_count > 0 ? `⚠️ ${s.active_warning_count} active` : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : watchlistTab === 'not_recoverable' ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 font-medium">
              Students on an inevitable detention trajectory where remaining semester sessions are mathematically insufficient to achieve 75%.
            </p>
            {notRecoverableList.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200 font-semibold text-xs">
                ✅ Zero students currently on irreversible detention trajectory. All students have recovery paths.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-purple-50 text-purple-900 font-bold uppercase border-b border-purple-200">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Course</th>
                      <th className="px-4 py-3 text-center">Current %</th>
                      <th className="px-4 py-3 text-center">Remaining Sessions</th>
                      <th className="px-4 py-3 text-center">Max Possible %</th>
                      <th className="px-4 py-3">Required Intervention</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {notRecoverableList.map((s, idx) => (
                      <tr key={idx} className="hover:bg-purple-50/30 transition">
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-slate-900">{s.roll_number}</span>
                          <span className="block text-[11px] text-slate-500 font-medium">{s.name}</span>
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {s.course_code} - {s.course_name}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-rose-700">
                          {s.current_percentage.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">
                          {s.sessions_remaining}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-purple-700">
                          {s.max_possible_percentage.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-rose-700">
                          Requires Condonation / Remedial Academic Counseling
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* Condonation Tracker Table */
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-slate-500 font-medium">
                Official JNTUH R25 Condonation Register for students in 65%–74.99% band. State machine: Pending &rarr; Applied &rarr; Approved &rarr; Fine Paid / Waived / Rejected.
              </p>
              {condonationFeedback && (
                <span className={`text-xs font-bold px-3 py-1 rounded-lg ${
                  condonationFeedback.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}>
                  {condonationFeedback.msg}
                </span>
              )}
            </div>

            {condonableList.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200 font-semibold text-xs">
                No students currently in the 65%–74.99% condonation band.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-amber-50 text-amber-900 font-bold uppercase border-b border-amber-200">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Course</th>
                      <th className="px-4 py-3 text-center">Current %</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center">Fine (₹)</th>
                      <th className="px-4 py-3 text-center">Update Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {condonableList.map((s, idx) => {
                      const currentStatus = (s.condonation_status || 'pending').toLowerCase();
                      const isUpdating = updatingStudentRoll === s.roll_number;

                      return (
                        <tr key={idx} className="hover:bg-amber-50/30 transition">
                          <td className="px-4 py-3">
                            <span className="font-mono font-bold text-slate-900">{s.roll_number}</span>
                            <span className="block text-[11px] text-slate-500 font-medium">{s.name}</span>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {s.course_code} - {s.course_name}
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-bold text-amber-700">
                            {s.current_percentage.toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase font-mono border ${
                              currentStatus === 'fine_paid' || currentStatus === 'paid'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : currentStatus === 'approved'
                                ? 'bg-blue-50 text-blue-800 border-blue-300'
                                : currentStatus === 'applied'
                                ? 'bg-amber-50 text-amber-800 border-amber-300'
                                : currentStatus === 'rejected'
                                ? 'bg-rose-50 text-rose-800 border-rose-300'
                                : 'bg-slate-100 text-slate-700 border-slate-300'
                            }`}>
                              {currentStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-bold text-slate-800">
                            ₹{s.fine_amount ?? 1000}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {currentStatus === 'pending' && (
                                <button
                                  onClick={() => handleUpdateCondonationStatus(s.roll_number, 'applied', s.fine_amount || 1000, 'Student applied for condonation')}
                                  disabled={isUpdating}
                                  className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold text-[10px] transition"
                                >
                                  Apply
                                </button>
                              )}
                              {currentStatus === 'applied' && (
                                <>
                                  <button
                                    onClick={() => handleUpdateCondonationStatus(s.roll_number, 'approved', s.fine_amount || 1000, 'Medical certificate approved')}
                                    disabled={isUpdating}
                                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] transition"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleUpdateCondonationStatus(s.roll_number, 'rejected', s.fine_amount || 1000, 'Invalid condonation proof')}
                                    disabled={isUpdating}
                                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-[10px] transition"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                              {currentStatus === 'approved' && (
                                <button
                                  onClick={() => handleUpdateCondonationStatus(s.roll_number, 'fine_paid', s.fine_amount || 1000, 'Fine payment receipt verified')}
                                  disabled={isUpdating}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] transition"
                                >
                                  Mark Paid
                                </button>
                              )}
                              {(currentStatus === 'fine_paid' || currentStatus === 'paid' || currentStatus === 'waived' || currentStatus === 'rejected') && (
                                <span className="text-[10px] text-slate-400 font-bold uppercase">
                                  {currentStatus === 'rejected' ? '⛔ Terminated' : '✅ Finalized'}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>

    </div>
  );
};
