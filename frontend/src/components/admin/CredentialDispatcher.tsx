import React, { useState, useEffect } from 'react';
import { apiRequest } from '../../services/api';
import { 
  Send, RefreshCw, Eye, RotateCcw, Loader2, CheckCircle2, 
  AlertCircle, Mail, TestTubes, KeyRound, Copy, Check, Zap, ShieldCheck 
} from 'lucide-react';

interface CredentialItem {
  sap_id: string;
  email: string;
  name?: string;
  error?: string;
}

interface BatchStatus {
  batch_id: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  completed: boolean;
  sent_items: CredentialItem[];
  failed_items: CredentialItem[];
}

export const CredentialDispatcher: React.FC = () => {
  const [targetRole, setTargetRole] = useState<'student' | 'teacher'>('student');
  const [sapIds, setSapIds] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [testEmail, setTestEmail] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

  // Retry state
  const [retryId, setRetryId] = useState('');
  const [retryEmail, setRetryEmail] = useState('');

  // Instant Login Recovery State (By Roll Number)
  const [recoveryRollNumber, setRecoveryRollNumber] = useState('');
  const [recoveryCustomPassword, setRecoveryCustomPassword] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const handleQuickReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryRollNumber.trim()) return;
    setRecoveryLoading(true);
    setRecoveryResult(null);
    setCopied(false);
    try {
      const res: any = await apiRequest('/admin/credentials/quick-reset', {
        method: 'POST',
        body: JSON.stringify({
          roll_number: recoveryRollNumber.trim().toUpperCase(),
          custom_password: recoveryCustomPassword.trim() || undefined
        })
      });
      setRecoveryResult(res);
    } catch (err: any) {
      setRecoveryResult({ status: 'error', error: err.message || 'Failed to generate credentials' });
    } finally {
      setRecoveryLoading(false);
    }
  };

  const copyCredentials = () => {
    if (!recoveryResult) return;
    const text = `SNIST Student Login Credentials:\nRoll Number: ${recoveryResult.roll_number}\nUsername: ${recoveryResult.username}\nPIN / Password: ${recoveryResult.temporary_password}\nPortal Link: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Poll batch status
  useEffect(() => {
    if (!batchId || !polling) return;
    const interval = setInterval(async () => {
      try {
        const res: any = await apiRequest(`/admin/credentials/batch/${batchId}/status`);
        setBatchStatus(res);
        if (res.completed) {
          setPolling(false);
        }
      } catch {
        setPolling(false);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [batchId, polling]);

  const dispatch = async () => {
    const ids = sapIds.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    setLoading(true);
    setResult(null);
    setBatchStatus(null);
    try {
      const res: any = await apiRequest('/admin/credentials/dispatch', {
        method: 'POST',
        body: JSON.stringify({ sap_ids: ids, target_role: targetRole, dry_run: dryRun }),
      });
      setResult(res);
      if (res.batch_id && !dryRun) {
        setBatchId(res.batch_id);
        setPolling(true);
      }
    } catch (err: any) {
      setResult({ status: 'error', error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const retryItem = async () => {
    if (!retryId) return;
    setLoading(true);
    try {
      const res: any = await apiRequest('/admin/credentials/retry', {
        method: 'POST',
        body: JSON.stringify({ sap_id: retryId, corrected_email: retryEmail || undefined }),
      });
      alert(`Retry ${res.status} for ${retryId}`);
      setRetryId('');
      setRetryEmail('');
      // Re-poll
      if (batchId) setPolling(true);
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const testSend = async () => {
    if (!testEmail) return;
    setLoading(true);
    try {
      const res: any = await apiRequest('/admin/credentials/test-send', {
        method: 'POST',
        body: JSON.stringify({ target_role: targetRole, test_email: testEmail }),
      });
      alert(`Test email ${res.status} → ${testEmail}`);
    } catch (err: any) {
      alert(`Test send failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const previewTemplate = async () => {
    try {
      const res: any = await apiRequest(`/admin/credentials/preview-template?target_role=${targetRole}`, { method: 'POST' });
      setPreviewHtml(res.html || '');
      setShowPreview(true);
    } catch (err: any) {
      alert(`Preview error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Role Toggle + Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl overflow-hidden border border-slate-300">
          <button onClick={() => setTargetRole('student')} className={`px-4 py-2 text-xs font-bold transition ${targetRole === 'student' ? 'bg-[#2f53d7] text-white' : 'bg-white text-slate-600'}`}>
            Student
          </button>
          <button onClick={() => setTargetRole('teacher')} className={`px-4 py-2 text-xs font-bold transition ${targetRole === 'teacher' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600'}`}>
            Teacher
          </button>
        </div>

        <button onClick={previewTemplate} className="px-3 py-2 text-xs font-bold text-[#2f53d7] bg-[#2f53d7]/10 rounded-xl flex items-center gap-1.5 hover:bg-[#2f53d7]/20 transition">
          <Eye className="w-3.5 h-3.5" /> Preview Template
        </button>
      </div>

      {/* Emergency Fallback: Instant Student Login Recovery / Credential Generator by Roll Number */}
      <div className="snist-card p-6 space-y-4 border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/50 via-white to-sky-50/30 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 pb-3">
          <div>
            <h3 className="font-heading text-sm font-bold text-[#15347e] flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-600" /> Instant Student Login Recovery (By Roll Number)
            </h3>
            <p className="text-[11px] text-[#6a7894] mt-0.5">
              Emergency student fallback: Automatically creates or resets student user account, activates onboarding, and clears 30-minute device lockouts.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-indigo-100 text-indigo-800 self-start sm:self-center">
            Emergency Tool
          </span>
        </div>

        <form onSubmit={handleQuickReset} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5 space-y-1">
            <label className="text-[10px] font-bold text-[#6a7894] uppercase tracking-wider">
              Student Roll Number <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={recoveryRollNumber}
              onChange={e => setRecoveryRollNumber(e.target.value)}
              placeholder="e.g. 24311A6204"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold uppercase focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 outline-none transition shadow-sm"
            />
          </div>

          <div className="sm:col-span-4 space-y-1">
            <label className="text-[10px] font-bold text-[#6a7894] uppercase tracking-wider">
              Custom PIN (Optional)
            </label>
            <input
              type="text"
              value={recoveryCustomPassword}
              onChange={e => setRecoveryCustomPassword(e.target.value)}
              placeholder="Auto-generates 6-digit PIN"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 outline-none transition shadow-sm"
            />
          </div>

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={recoveryLoading || !recoveryRollNumber.trim()}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 disabled:opacity-50 transition shadow-md"
            >
              {recoveryLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Generate &amp; Unlock</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Recovery Result Box */}
        {recoveryResult && (
          <div className="mt-3 animate-in fade-in duration-200">
            {recoveryResult.status === 'error' ? (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="font-semibold">{recoveryResult.error}</span>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-white border-2 border-emerald-300 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">
                        {recoveryResult.student_name} ({recoveryResult.roll_number})
                      </h4>
                      <p className="text-[11px] text-slate-500 font-mono">{recoveryResult.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                      ✓ Activated
                    </span>
                    <span className="px-2 py-0.5 bg-sky-100 text-sky-800 text-[10px] font-bold rounded-full">
                      ✓ Lockout Cleared
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Generated Student Password / PIN:
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-lg font-mono font-extrabold text-indigo-700 tracking-wider bg-white px-3 py-1 rounded-lg border border-slate-200 shadow-inner">
                        {recoveryResult.temporary_password}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        (Username: {recoveryResult.username})
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={copyCredentials}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95 ${
                      copied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                    }`}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied to Clipboard!' : 'Copy Credentials'}</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-600 leading-snug">
                  Provide these credentials to the student. They can now immediately log in at <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-800 font-mono font-bold">/login</code> without any lockout.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SAP IDs Input */}
      <div className="snist-card p-5 space-y-4">
        <h3 className="font-heading text-sm font-bold text-[#15347e] flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#2f53d7]" /> Dispatch Credentials — {targetRole === 'student' ? 'Students' : 'Teachers'}
        </h3>

        <div>
          <label className="text-[10px] font-bold text-[#6a7894] uppercase">Roll Numbers / Faculty Codes (one per line or comma-separated)</label>
          <textarea
            value={sapIds}
            onChange={e => setSapIds(e.target.value)}
            rows={5}
            placeholder="24311A6201&#10;24311A6204&#10;24311A6207"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono mt-1 resize-y focus:border-[#2f53d7] focus:ring-2 focus:ring-[#2f53d7]/10 outline-none"
          />
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="rounded text-[#2f53d7]" />
            <span className="text-xs font-semibold text-[#6a7894]">Dry Run (preview only, no emails sent)</span>
          </label>
          <button onClick={dispatch} disabled={loading || !sapIds.trim()} className="px-5 py-2.5 bg-[#2f53d7] text-white font-bold rounded-xl text-xs flex items-center gap-2 disabled:opacity-50 shadow-md transition active:scale-95">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {dryRun ? 'Preview Dispatch' : 'Send Credentials'}
          </button>
        </div>

        {/* Test Send */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
          <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="your-email@test.com" className="px-3 py-2 border rounded-xl text-xs flex-1" />
          <button onClick={testSend} disabled={!testEmail || loading} className="px-3 py-2 bg-amber-100 text-amber-700 font-bold rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50">
            <TestTubes className="w-3.5 h-3.5" /> Test Send
          </button>
        </div>
      </div>

      {/* Dispatch Result */}
      {result && (
        <div className={`snist-card p-4 text-xs ${result.status === 'dispatching' ? 'border-blue-200 bg-blue-50' : result.status === 'dry_run' ? 'border-amber-200 bg-amber-50' : result.status === 'error' ? 'border-red-200 bg-red-50' : ''}`}>
          {result.status === 'dispatching' && <p className="font-bold text-blue-700">📤 Dispatching {result.total_queued} credential emails... (Batch: {result.batch_id})</p>}
          {result.status === 'dry_run' && (
            <div>
              <p className="font-bold text-amber-700 mb-2">DRY RUN — {result.total} recipients validated</p>
              {result.preview?.map((p: any, i: number) => (
                <p key={i} className="text-[11px] text-slate-600">{p.sap_id} → {p.email} ({p.name})</p>
              ))}
            </div>
          )}
          {result.status === 'error' && <p className="font-bold text-red-700">✗ {result.error}</p>}
          {result.errors?.length > 0 && (
            <div className="mt-2">
              <p className="font-bold text-red-600">Errors:</p>
              {result.errors.map((e: any, i: number) => <p key={i} className="text-red-500">{e.sap_id}: {e.error}</p>)}
            </div>
          )}
        </div>
      )}

      {/* Batch Progress */}
      {batchStatus && (
        <div className="snist-card p-5 space-y-3">
          <h4 className="text-xs font-bold text-[#15347e] flex items-center gap-2">
            {batchStatus.completed ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Loader2 className="w-4 h-4 animate-spin text-[#2f53d7]" />}
            Batch: {batchId} — {batchStatus.completed ? 'Complete' : 'Dispatching...'}
          </h4>

          {/* Progress Bar */}
          <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#2f53d7] to-emerald-500 rounded-full transition-all" style={{ width: `${batchStatus.total ? ((batchStatus.sent + batchStatus.failed) / batchStatus.total) * 100 : 0}%` }} />
          </div>
          <div className="flex gap-4 text-xs">
            <span className="text-emerald-600 font-bold">✓ Sent: {batchStatus.sent}</span>
            <span className="text-red-500 font-bold">✗ Failed: {batchStatus.failed}</span>
            <span className="text-slate-400">⏳ Pending: {batchStatus.pending}</span>
          </div>

          {/* Failed Items with Retry */}
          {batchStatus.failed_items.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-bold text-red-600">Failed Items:</p>
              {batchStatus.failed_items.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-red-700">{f.sap_id}</span>
                  <span className="text-red-400">{f.email}: {f.error}</span>
                  <button onClick={() => { setRetryId(f.sap_id); setRetryEmail(f.email); }} className="text-[#2f53d7] font-bold hover:underline">Retry</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Retry Single */}
      {retryId && (
        <div className="snist-card p-4 flex items-center gap-3">
          <span className="text-xs font-bold">Retry {retryId}:</span>
          <input value={retryEmail} onChange={e => setRetryEmail(e.target.value)} placeholder="Corrected email (optional)" className="px-3 py-1.5 border rounded-lg text-xs flex-1" />
          <button onClick={retryItem} disabled={loading} className="px-3 py-1.5 bg-[#2f53d7] text-white font-bold rounded-lg text-xs">
            <RotateCcw className="w-3 h-3 inline mr-1" />Retry
          </button>
          <button onClick={() => setRetryId('')} className="text-xs text-slate-400">Cancel</button>
        </div>
      )}

      {/* Template Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-1" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-sm font-bold text-[#15347e]">Email Template Preview</h3>
              <button onClick={() => setShowPreview(false)} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
            </div>
            <div className="p-2" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      )}
    </div>
  );
};
