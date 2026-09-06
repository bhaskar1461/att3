import React, { useState, useEffect } from 'react';
import { 
  Smartphone, Search, RefreshCw, AlertTriangle, CheckCircle2, 
  Trash2, ShieldAlert, BarChart3, Users, Clock, ArrowRight, ShieldCheck
} from 'lucide-react';
import { apiRequest } from '../../services/api';

export const DeviceManager: React.FC = () => {
  // Telemetry state
  const [telemetry, setTelemetry] = useState<any>(null);
  const [isTelemetryLoading, setIsTelemetryLoading] = useState(false);

  // Single Search State
  const [searchRoll, setSearchRoll] = useState('');
  const [studentInfo, setStudentInfo] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isResettingSingle, setIsResettingSingle] = useState(false);

  // Bulk Reset State
  const [bulkInput, setBulkInput] = useState('');
  const [bulkConfirmation, setBulkConfirmation] = useState('');
  const [isBulkResetting, setIsBulkResetting] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Toast / Feedback
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchTelemetry();
  }, []);

  const fetchTelemetry = async () => {
    setIsTelemetryLoading(true);
    try {
      const data: any = await apiRequest('/telemetry/summary?hours=24');
      setTelemetry(data);
    } catch (err) {
      console.warn('Could not load telemetry summary:', err);
    } finally {
      setIsTelemetryLoading(false);
    }
  };

  const handleSearchStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchRoll.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    setStudentInfo(null);
    setActionSuccess(null);

    try {
      const data: any = await apiRequest(`/devices/student-device-info?roll_number=${encodeURIComponent(searchRoll.trim().toUpperCase())}`);
      setStudentInfo(data);
    } catch (err: any) {
      setSearchError(err.message || 'Student not found or error loading device info.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleResetSingle = async () => {
    if (!studentInfo) return;
    if (!window.confirm(`Reset device binding for ${studentInfo.roll_number}? This will unlink their phone.`)) {
      return;
    }

    setIsResettingSingle(true);
    setActionSuccess(null);
    try {
      await apiRequest('/devices/reset-student-enrollment', {
        method: 'POST',
        body: JSON.stringify({ roll_number: studentInfo.roll_number })
      });
      setActionSuccess(`Device binding cleared for ${studentInfo.roll_number}. Student will auto-enroll on next login.`);
      // Refresh student info
      const updated: any = await apiRequest(`/devices/student-device-info?roll_number=${encodeURIComponent(studentInfo.roll_number)}`);
      setStudentInfo(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to reset device.');
    } finally {
      setIsResettingSingle(false);
    }
  };

  // Parse bulk input roll numbers
  const parsedRolls = bulkInput
    .split(/[\n,]+/)
    .map(r => r.trim().toUpperCase())
    .filter(r => r.length > 0);

  const expectedBulkConfirm = `RESET ${parsedRolls.length} DEVICES`;

  const handleBulkReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedRolls.length === 0) {
      setBulkError('Please enter at least one roll number.');
      return;
    }

    if (bulkConfirmation.trim() !== expectedBulkConfirm) {
      setBulkError(`Confirmation text must match exactly: "${expectedBulkConfirm}"`);
      return;
    }

    setIsBulkResetting(true);
    setBulkError(null);
    setBulkResult(null);

    try {
      const data: any = await apiRequest('/devices/bulk-reset', {
        method: 'POST',
        body: JSON.stringify({
          roll_numbers: parsedRolls,
          confirmation: bulkConfirmation.trim()
        })
      });
      setBulkResult(data);
      setBulkInput('');
      setBulkConfirmation('');
    } catch (err: any) {
      setBulkError(err.message || 'Bulk reset failed.');
    } finally {
      setIsBulkResetting(false);
    }
  };

  return (
    <div className="space-y-8 font-sans">
      
      {/* 1. Telemetry Overview Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-[#15347e]">Rollout & PWA Install Telemetry (Last 24 Hours)</h3>
              <p className="text-xs text-slate-500">Live signals to identify day-1 student onboarding bottlenecks</p>
            </div>
          </div>
          <button
            onClick={fetchTelemetry}
            disabled={isTelemetryLoading}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
            title="Refresh Telemetry"
          >
            <RefreshCw className={`w-4 h-4 ${isTelemetryLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {telemetry ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Launches</span>
              <p className="text-xl font-extrabold text-slate-900 mt-1">{telemetry.total_events || 0}</p>
              <span className="text-[11px] text-slate-400">All portal visits</span>
            </div>

            <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
              <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">PWA Standalone</span>
              <p className="text-xl font-extrabold text-emerald-700 mt-1">{telemetry.standalone_launches || 0}</p>
              <span className="text-[11px] text-emerald-600">Running from home screen</span>
            </div>

            <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
              <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Browser Blocks</span>
              <p className="text-xl font-extrabold text-amber-700 mt-1">{telemetry.install_guard_blocks || 0}</p>
              <span className="text-[11px] text-amber-600">Attempted scan in browser tab</span>
            </div>

            <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
              <span className="text-[11px] font-bold text-purple-800 uppercase tracking-wider">Platform Split</span>
              <p className="text-sm font-extrabold text-purple-900 mt-1.5">
                iOS: {telemetry.platform_breakdown?.ios || 0} | Android: {telemetry.platform_breakdown?.android || 0}
              </p>
              <span className="text-[11px] text-purple-600">Safari vs Chrome</span>
            </div>
          </div>
        ) : (
          <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
            {isTelemetryLoading ? 'Loading live telemetry...' : 'No telemetry data recorded in the last 24 hours.'}
          </div>
        )}
      </div>

      {/* 2. Single Student Device Search & Reset */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-[#15347e]">Student Device Lookup & Individual Reset</h3>
            <p className="text-xs text-slate-500">Inspect bound device details and clear bindings for phone replacements</p>
          </div>
        </div>

        <form onSubmit={handleSearchStudent} className="flex gap-2 max-w-md">
          <input
            type="text"
            placeholder="Enter Roll Number (e.g. 23311A05Y6)"
            value={searchRoll}
            onChange={(e) => setSearchRoll(e.target.value.toUpperCase())}
            className="snist-input flex-1 uppercase font-mono text-xs font-bold"
          />
          <button
            type="submit"
            disabled={isSearching || !searchRoll.trim()}
            className="px-4 py-2 snist-btn-primary text-xs font-bold flex items-center gap-1.5 shadow-sm"
          >
            <Search className="w-3.5 h-3.5" /> {isSearching ? 'Searching...' : 'Lookup'}
          </button>
        </form>

        {searchError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 font-medium">
            {searchError}
          </div>
        )}

        {actionSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            {actionSuccess}
          </div>
        )}

        {studentInfo && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h4 className="font-bold text-sm text-slate-900">{studentInfo.name}</h4>
                <p className="text-xs font-mono font-bold text-[#2f53d7]">{studentInfo.roll_number} • {studentInfo.email}</p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                  studentInfo.has_registered_device ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {studentInfo.has_registered_device ? 'Device Bound' : 'No Device Bound'}
                </span>

                <button
                  onClick={handleResetSingle}
                  disabled={isResettingSingle || !studentInfo.has_registered_device}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isResettingSingle ? 'Resetting...' : 'Reset Device'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-500 text-[11px] font-medium">Device Fingerprint:</span>
                <p className="font-mono font-bold text-slate-900 mt-0.5">
                  {studentInfo.registered_device?.device_public_id || 'None (Ready for auto-enrollment)'}
                </p>
              </div>

              <div>
                <span className="text-slate-500 text-[11px] font-medium">Last Seen:</span>
                <p className="font-medium text-slate-700 mt-0.5">
                  {studentInfo.registered_device?.last_seen_at ? new Date(studentInfo.registered_device.last_seen_at).toLocaleString() : 'N/A'}
                </p>
              </div>

              <div>
                <span className="text-slate-500 text-[11px] font-medium">Semester Self-Resets:</span>
                <p className="font-bold text-slate-900 mt-0.5">
                  {studentInfo.self_resets_this_semester} / {studentInfo.max_self_resets} used
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Bulk Reset Section with Typed Confirmation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center font-bold">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-[#15347e]">Bulk Device Reset (Emergency / Batch Recovery)</h3>
            <p className="text-xs text-slate-500">Unbinds registered devices for a list of students simultaneously</p>
          </div>
        </div>

        <form onSubmit={handleBulkReset} className="space-y-4 max-w-xl">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Roll Numbers (separated by commas or new lines):
            </label>
            <textarea
              rows={3}
              placeholder="e.g. 23311A05Y6, 24311A6204"
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              className="snist-input w-full font-mono text-xs uppercase"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Parsed students: <strong>{parsedRolls.length}</strong>
            </p>
          </div>

          {parsedRolls.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2">
              <p className="text-xs text-amber-900 font-medium">
                To confirm this bulk unbinding, type exactly: <strong className="font-mono text-amber-950 bg-amber-100 px-1.5 py-0.5 rounded">{expectedBulkConfirm}</strong>
              </p>
              <input
                type="text"
                placeholder={`Type "${expectedBulkConfirm}" to confirm`}
                value={bulkConfirmation}
                onChange={(e) => setBulkConfirmation(e.target.value)}
                className="snist-input w-full text-xs font-mono font-bold"
              />
            </div>
          )}

          {bulkError && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 font-medium">
              {bulkError}
            </div>
          )}

          {bulkResult && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 font-medium">
              {bulkResult.message} ({bulkResult.reset_count} students cleared)
            </div>
          )}

          <button
            type="submit"
            disabled={isBulkResetting || parsedRolls.length === 0 || bulkConfirmation.trim() !== expectedBulkConfirm}
            className="py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-sm disabled:opacity-40 flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isBulkResetting ? 'Processing Bulk Reset...' : `Execute Bulk Reset (${parsedRolls.length} Students)`}
          </button>
        </form>
      </div>

    </div>
  );
};
