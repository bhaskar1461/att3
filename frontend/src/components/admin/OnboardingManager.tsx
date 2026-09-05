import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../../services/api';
import { Upload, Send, RefreshCw, Search, ChevronDown, AlertCircle, CheckCircle2, Clock, Loader2, Eye, RotateCcw, Shield } from 'lucide-react';

interface OnboardingStudent {
  id: number;
  roll_number: string;
  name: string;
  email: string;
  department: string;
  section: string;
  state: string;
  link_sent_at: string | null;
  activated_at: string | null;
  otp_verified: boolean;
  pin_set: boolean;
  device_uuid: string | null;
  rebind_count: number;
  batch_ref: string;
}

interface ImportResult {
  status: string;
  batch_ref: string;
  created?: number;
  skipped?: number;
  teacher_notified?: string | null;
  total_parsed?: number;
  errors?: any[];
  preview?: any[];
}

const STATE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_ONBOARDING: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Pending' },
  LINK_SENT: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Link Sent' },
  LINK_OPENED: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'In Progress' },
  ACTIVATED: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Activated' },
  EXPIRED: { bg: 'bg-red-100', text: 'text-red-600', label: 'Expired' },
  SUSPENDED: { bg: 'bg-red-200', text: 'text-red-800', label: 'Suspended' },
};

export const OnboardingManager: React.FC = () => {
  const [students, setStudents] = useState<OnboardingStudent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchRoll, setSearchRoll] = useState('');

  // Import modal
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDeptCode, setImportDeptCode] = useState('CSE-CS');
  const [importDeptId, setImportDeptId] = useState('1');
  const [importYearId, setImportYearId] = useState('3');
  const [importYearName, setImportYearName] = useState('III - I');
  const [importSectionId, setImportSectionId] = useState('1');
  const [importEmailPattern, setImportEmailPattern] = useState('{roll}@cs.sreenidhi.edu.in');
  const [importInchargeEmail, setImportInchargeEmail] = useState('sowjanya.n@sreenidhi.edu.in');
  const [importDryRun, setImportDryRun] = useState(true);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  // Dispatch state
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchOnboarding(); }, [page, stateFilter]);

  const fetchOnboarding = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '25' });
      if (stateFilter) params.set('state', stateFilter);
      const res: any = await apiRequest(`/admin/onboard/status?${params}`);
      setStudents(res.students || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      console.error('Fetch onboarding error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append('file', importFile);
      form.append('department_code', importDeptCode);
      form.append('department_id', importDeptId);
      form.append('academic_year_id', importYearId);
      form.append('academic_year_name', importYearName);
      form.append('section_id', importSectionId);
      form.append('email_pattern', importEmailPattern);
      form.append('class_incharge_email', importInchargeEmail);
      form.append('dry_run', String(importDryRun));

      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/admin/onboard/import-excel', {
        method: 'POST',
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        let errorMsg = 'Import failed';
        if (Array.isArray(data.detail)) {
          errorMsg = data.detail.map((d: any) => {
            const field = d.loc ? d.loc.filter((x: any) => x !== 'body').join('.') : '';
            return field ? `${field}: ${d.msg || d.error || JSON.stringify(d)}` : (d.msg || d.error || JSON.stringify(d));
          }).join(', ');
        } else if (typeof data.detail === 'string') {
          errorMsg = data.detail;
        } else if (data.detail && typeof data.detail === 'object') {
          errorMsg = JSON.stringify(data.detail);
        } else if (data.message) {
          errorMsg = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
        }
        throw new Error(errorMsg);
      }
      setImportResult(data);
      if (data.status === 'success') {
        fetchOnboarding();
      }
    } catch (err: any) {
      setImportResult({ status: 'error', batch_ref: '', errors: [{ error: err.message || 'Unknown import error' }] });
    } finally {
      setImportLoading(false);
    }
  };

  const dispatchLinks = async () => {
    setDispatchLoading(true);
    try {
      const res: any = await apiRequest('/admin/onboard/dispatch-links', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setDispatchResult(res);
      fetchOnboarding();
    } catch (err: any) {
      setDispatchResult({ status: 'error', error: err.message });
    } finally {
      setDispatchLoading(false);
    }
  };

  const resendLink = async (roll: string) => {
    try {
      await apiRequest(`/admin/onboard/resend/${roll}`, { method: 'POST', body: JSON.stringify({}) });
      fetchOnboarding();
    } catch (err: any) {
      alert(`Resend failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setShowImport(!showImport)} className="px-4 py-2.5 bg-[#2f53d7] text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-md transition active:scale-95">
          <Upload className="w-4 h-4" /> Import Excel
        </button>
        <button onClick={dispatchLinks} disabled={dispatchLoading} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-md transition active:scale-95 disabled:opacity-50">
          {dispatchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Dispatch Magic Links
        </button>
        <select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium bg-white">
          <option value="">All States</option>
          <option value="PENDING_ONBOARDING">Pending</option>
          <option value="LINK_SENT">Link Sent</option>
          <option value="LINK_OPENED">In Progress</option>
          <option value="ACTIVATED">Activated</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <button onClick={fetchOnboarding} className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 transition">
          <RefreshCw className="w-4 h-4 text-slate-600" />
        </button>
        <span className="text-xs text-slate-500 ml-auto">{total} students</span>
      </div>

      {/* Dispatch Result */}
      {dispatchResult && (
        <div className={`p-4 rounded-xl text-xs font-medium space-y-1 ${dispatchResult.status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          <div className="font-bold flex items-center gap-1.5">
            {dispatchResult.status === 'success' ? (
              <span>✓ Dispatched {dispatchResult.dispatched} student magic links ({dispatchResult.failed} failed)</span>
            ) : (
              <span>✗ Error: {dispatchResult.error}</span>
            )}
          </div>
          {dispatchResult.status === 'success' && dispatchResult.teacher_notified && dispatchResult.teacher_notified.length > 0 && (
            <div className="text-emerald-800 flex items-center gap-1 text-[11px] font-semibold">
              <span>📬 Class In-Charge Timetable &amp; Schedule Notification sent to: <strong>{dispatchResult.teacher_notified.join(', ')}</strong> (Students dispatched without CC)</span>
            </div>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="snist-card p-5 space-y-4 border-[#2f53d7]/20">
          <h3 className="font-heading text-sm font-bold text-[#15347e] flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#2f53d7]" /> Excel Import — Student Onboarding
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-[#6a7894] uppercase">Excel File (CSE-CS Format)</label>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={e => setImportFile(e.target.files?.[0] || null)} className="w-full text-xs mt-1 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#2f53d7]/10 file:text-[#2f53d7]" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#6a7894] uppercase">Department Code</label>
              <input value={importDeptCode} onChange={e => setImportDeptCode(e.target.value)} placeholder="CSE-CS" className="w-full px-3 py-2 border rounded-xl text-xs mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#6a7894] uppercase">Email Pattern</label>
              <input value={importEmailPattern} onChange={e => setImportEmailPattern(e.target.value)} placeholder="{roll}@cse.sreenidhi.edu.in" className="w-full px-3 py-2 border rounded-xl text-xs mt-1 font-mono" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#6a7894] uppercase">Class In-charge Email</label>
              <input value={importInchargeEmail} onChange={e => setImportInchargeEmail(e.target.value)} placeholder="incharge@sreenidhi.edu.in" className="w-full px-3 py-2 border rounded-xl text-xs mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#6a7894] uppercase">Year/Semester</label>
              <input value={importYearName} onChange={e => setImportYearName(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#6a7894] uppercase">Dept ID / Year ID / Section ID</label>
              <div className="flex gap-2 mt-1">
                <input value={importDeptId} onChange={e => setImportDeptId(e.target.value)} placeholder="Dept" className="w-1/3 px-2 py-2 border rounded-xl text-xs" />
                <input value={importYearId} onChange={e => setImportYearId(e.target.value)} placeholder="Year" className="w-1/3 px-2 py-2 border rounded-xl text-xs" />
                <input value={importSectionId} onChange={e => setImportSectionId(e.target.value)} placeholder="Section" className="w-1/3 px-2 py-2 border rounded-xl text-xs" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={importDryRun} onChange={e => setImportDryRun(e.target.checked)} className="rounded text-[#2f53d7]" />
              <span className="text-xs font-semibold text-[#6a7894]">Dry Run (preview only)</span>
            </label>
            <button onClick={handleImport} disabled={!importFile || importLoading} className="px-4 py-2 bg-[#2f53d7] text-white font-bold rounded-xl text-xs flex items-center gap-2 disabled:opacity-50">
              {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importDryRun ? 'Preview Import' : 'Import & Create Records'}
            </button>
          </div>

          {importResult && (
            <div className={`p-3 rounded-xl text-xs ${importResult.status === 'success' ? 'bg-emerald-50 border-emerald-200' : importResult.status === 'dry_run' ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'} border`}>
              {importResult.status === 'success' && (
                <div>
                  <p className="font-bold text-emerald-700">✓ Created {importResult.created}, Skipped {importResult.skipped} (already activated)</p>
                  {importResult.teacher_notified && (
                    <p className="text-emerald-800 text-[11px] mt-1 font-semibold">📬 Class In-Charge Timetable &amp; Schedule Notification sent to: <strong>{importResult.teacher_notified}</strong></p>
                  )}
                </div>
              )}
              {importResult.status === 'dry_run' && (
                <div>
                  <p className="font-bold text-blue-700 mb-2">DRY RUN — {importResult.total_parsed} students parsed</p>
                  {importResult.preview?.map((s: any, i: number) => (
                    <p key={i} className="text-[11px] text-slate-600">{s.roll_number} — {s.name} — {s.email}</p>
                  ))}
                </div>
              )}
              {importResult.errors && importResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="font-bold text-red-600">Errors ({importResult.errors.length}):</p>
                  {importResult.errors.slice(0, 10).map((e: any, i: number) => {
                    const errText = typeof e.error === 'object' ? JSON.stringify(e.error) : (e.error || e.msg || e.detail || JSON.stringify(e));
                    const label = e.roll || e.sap_id || (e.row ? `Row ${e.row}` : '');
                    return (
                      <p key={i} className="text-[11px] text-red-500">{label ? `${label}: ` : ''}{errText}</p>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Status Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-[#17233c] font-bold uppercase border-b border-slate-200">
            <tr>
              <th className="py-3 px-3">Roll Number</th>
              <th className="py-3 px-3">Name</th>
              <th className="py-3 px-3">Email</th>
              <th className="py-3 px-3">State</th>
              <th className="py-3 px-3">OTP</th>
              <th className="py-3 px-3">PIN</th>
              <th className="py-3 px-3">Device</th>
              <th className="py-3 px-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {isLoading ? (
              <tr><td colSpan={8} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-[#2f53d7]" /></td></tr>
            ) : students.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-slate-500">No onboarding records. Import students to get started.</td></tr>
            ) : (
              students.map(s => {
                const stateInfo = STATE_COLORS[s.state] || { bg: 'bg-slate-100', text: 'text-slate-600', label: s.state };
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono font-bold text-[#15347e]">{s.roll_number}</td>
                    <td className="py-2.5 px-3 font-medium">{s.name}</td>
                    <td className="py-2.5 px-3 text-slate-500 font-mono text-[10px]">{s.email}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${stateInfo.bg} ${stateInfo.text}`}>{stateInfo.label}</span>
                    </td>
                    <td className="py-2.5 px-3">{s.otp_verified ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4 text-slate-300" />}</td>
                    <td className="py-2.5 px-3">{s.pin_set ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4 text-slate-300" />}</td>
                    <td className="py-2.5 px-3 text-[10px] font-mono text-slate-400">{s.device_uuid || '—'}</td>
                    <td className="py-2.5 px-3">
                      {s.state !== 'ACTIVATED' && (
                        <button onClick={() => resendLink(s.roll_number)} className="text-[10px] font-bold text-[#2f53d7] hover:underline">Resend</button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="flex justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-xs font-bold bg-slate-100 rounded-lg disabled:opacity-50">← Prev</button>
          <span className="px-3 py-1.5 text-xs text-slate-500">Page {page} of {Math.ceil(total / 25)}</span>
          <button disabled={page >= Math.ceil(total / 25)} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-xs font-bold bg-slate-100 rounded-lg disabled:opacity-50">Next →</button>
        </div>
      )}
    </div>
  );
};
