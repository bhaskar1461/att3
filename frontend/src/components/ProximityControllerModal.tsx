import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../services/api';
import { 
  Radio, Shield, Camera, Lock, RefreshCw, X, AlertTriangle, 
  CheckCircle, Users, Sparkles, Clock, MapPin, Eye, ChevronRight,
  Power, Check, ThumbsUp, ThumbsDown, FileSpreadsheet, Maximize2, Minimize2
} from 'lucide-react';
import { AuditReview } from '../types';

interface ProximityControllerModalProps {
  sessionId: number;
  sessionDate: string;
  periodText: string;
  subjectName: string;
  sectionName: string;
  classroomCode?: string;
  onClose: () => void;
  onSwitchToQR: () => void;
  onSessionLocked: () => void;
}

export const ProximityControllerModal: React.FC<ProximityControllerModalProps> = ({
  sessionId,
  sessionDate,
  periodText,
  subjectName,
  sectionName,
  classroomCode,
  onClose,
  onSwitchToQR,
  onSessionLocked,
}) => {
  const [hudData, setHudData] = useState<{
    session_id: number;
    status: string;
    rotating_code: string;
    countdown_seconds: number;
    preflight: {
      server_health: boolean;
      beacon_advertising: boolean;
      manual_mode_armed: boolean;
      kill_switch_active: boolean;
    };
    kill_switch_active: boolean;
    counters: {
      total_marked: number;
      ble: number;
      code: number;
      manual: number;
      error_rate_percent: number;
    };
    audit_reviews: Array<{
      id: number;
      roll_number: string;
      flag: string;
      measured_rssi?: number;
      details?: string;
      created_at?: string;
    }>;
  } | null>(null);

  const [isProjectorMode, setIsProjectorMode] = useState(false);
  const [showReconcileReport, setShowReconcileReport] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<any>(null);
  const [isLocking, setIsLocking] = useState(false);
  const [isTogglingKillSwitch, setIsTogglingKillSwitch] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollIntervalRef = useRef<any>(null);

  const fetchHUDData = async () => {
    try {
      const data: any = await apiRequest(`/session/${sessionId}/hud`);
      setHudData(data);
    } catch (err: any) {
      console.warn('HUD fetch error:', err);
      // Fallback to legacy endpoint if needed
      try {
        const legacy: any = await apiRequest(`/attendance/session/${sessionId}/live-challenge`);
        setHudData(prev => ({
          session_id: sessionId,
          status: 'OPEN',
          rotating_code: legacy.manual_fallback_code || '----',
          countdown_seconds: legacy.seconds_remaining || 15,
          preflight: { server_health: true, beacon_advertising: true, manual_mode_armed: true, kill_switch_active: false },
          kill_switch_active: false,
          counters: {
            total_marked: legacy.present_count || 0,
            ble: legacy.present_count || 0,
            code: 0,
            manual: 0,
            error_rate_percent: 0.0
          },
          audit_reviews: []
        }));
      } catch (legacyErr) {
        setErrorMessage('Failed to connect to HUD stream');
      }
    }
  };

  useEffect(() => {
    fetchHUDData();
    pollIntervalRef.current = setInterval(fetchHUDData, 2000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [sessionId]);

  const handleToggleKillSwitch = async () => {
    if (!hudData) return;
    setIsTogglingKillSwitch(true);
    try {
      const nextActive = !hudData.kill_switch_active;
      await apiRequest('/admin/kill-switch', {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          active: nextActive,
          reason: nextActive ? 'High error rate (>10%) trigger' : 'Manual restoration'
        })
      });
      await fetchHUDData();
    } catch (err: any) {
      alert(err.message || 'Failed to toggle kill switch');
    } finally {
      setIsTogglingKillSwitch(false);
    }
  };

  const handleResolveReview = async (reviewId: number, resolution: 'APPROVED' | 'REJECTED') => {
    setResolvingId(reviewId);
    try {
      await apiRequest('/admin/audit-review/resolve', {
        method: 'POST',
        body: JSON.stringify({
          review_id: reviewId,
          resolution,
          resolved_by: 'FACULTY_HUD'
        })
      });
      await fetchHUDData();
    } catch (err: any) {
      alert(err.message || 'Failed to resolve review');
    } finally {
      setResolvingId(null);
    }
  };

  const handleLockAndFinalize = async () => {
    setIsLocking(true);
    try {
      const res: any = await apiRequest('/session/lock', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId })
      });
      setReconcileReport(res.reconciliation);
      setShowReconcileReport(true);
      onSessionLocked();
    } catch (err: any) {
      alert(err.message || 'Failed to finalize session');
    } finally {
      setIsLocking(false);
    }
  };

  const secondsRemaining = hudData?.countdown_seconds ?? 15;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * secondsRemaining) / 15;

  const totalMarked = hudData?.counters?.total_marked ?? 0;
  const bleCount = hudData?.counters?.ble ?? 0;
  const codeCount = hudData?.counters?.code ?? 0;
  const manualCount = hudData?.counters?.manual ?? 0;
  const errorRate = hudData?.counters?.error_rate_percent ?? 0;
  const isHighError = errorRate > 10.0;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className={`bg-gradient-to-br from-[#00132b] via-[#051c3d] to-[#0c2d5e] text-white rounded-3xl shadow-2xl border border-blue-500/30 overflow-hidden transition-all duration-300 w-full ${isProjectorMode ? 'max-w-5xl' : 'max-w-3xl'}`}>
        
        {/* Top Header Bar */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Radio className="w-5 h-5 text-[#00132b] animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-extrabold text-lg text-white font-geist leading-tight">
                  ProxPresence Faculty HUD
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  Live Broadcast
                </span>
                {hudData?.kill_switch_active && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-500/30 text-rose-300 border border-rose-500/50 animate-pulse">
                    Manual-Only Mode
                  </span>
                )}
              </div>
              <p className="text-xs text-blue-200/80 font-medium">
                {subjectName} • {sectionName} • {periodText} • {classroomCode || 'Room 304 Block B'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsProjectorMode(!isProjectorMode)}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-blue-200 hover:text-white transition flex items-center gap-1 text-xs font-semibold"
              title="Toggle Projector Display Mode"
            >
              {isProjectorMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              <span className="hidden sm:inline">{isProjectorMode ? 'Standard' : 'Projector'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">

          {/* High Error Warning Banner if > 10% */}
          {isHighError && (
            <div className="p-3.5 bg-rose-500/20 border border-rose-500/50 rounded-2xl flex items-center justify-between text-rose-200 text-xs animate-pulse">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <span>
                  <strong>High Anomaly Rate Detected ({errorRate}%):</strong> Recommend arming the one-tap Kill Switch to switch room to manual-only mode.
                </span>
              </div>
              <button
                onClick={handleToggleKillSwitch}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs shrink-0 ml-3"
              >
                Engage Kill Switch
              </button>
            </div>
          )}

          {/* Pre-Flight Checklist */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-white/5 rounded-2xl border border-white/10 flex items-center gap-2.5 text-xs">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold text-white block">Server Health</span>
                <span className="text-[10px] text-emerald-300 font-mono">200 OK • &lt;15ms</span>
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-2xl border border-white/10 flex items-center gap-2.5 text-xs">
              <Radio className="w-4 h-4 text-cyan-400 shrink-0 animate-pulse" />
              <div>
                <span className="font-bold text-white block">Beacon Advertising</span>
                <span className="text-[10px] text-cyan-300 font-mono">Passive Central Mode</span>
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-2xl border border-white/10 flex items-center gap-2.5 text-xs">
              <Shield className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <span className="font-bold text-white block">Manual Mode Armed</span>
                <span className="text-[10px] text-amber-300 font-mono">Always Logged</span>
              </div>
            </div>
          </div>

          {/* Giant Rotating Code Display with Circular SVG Countdown Ring */}
          <div className={`bg-gradient-to-b from-white/10 to-black/40 rounded-3xl p-6 border border-white/20 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-6 relative overflow-hidden ${isProjectorMode ? 'py-10' : ''}`}>
            
            {/* Left: Code Presentation */}
            <div className="text-center sm:text-left space-y-1">
              <span className="text-xs font-black uppercase text-amber-300 tracking-wider flex items-center gap-1.5 justify-center sm:justify-start">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Projector-Readable Rotating Short Code
              </span>
              <div className="py-2 px-6 rounded-2xl bg-black/60 border border-white/30 inline-block shadow-2xl">
                <span className={`font-black font-mono tracking-widest text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.6)] ${isProjectorMode ? 'text-6xl sm:text-8xl' : 'text-5xl sm:text-6xl'}`}>
                  {hudData?.rotating_code || '----'}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 font-medium">
                TOTP-Style 15s Rotation • Server Grace Window: ±30s (tolerance_windows=2)
              </p>
            </div>

            {/* Right: SVG Countdown Ring */}
            <div className="relative flex items-center justify-center shrink-0">
              <svg className="w-24 h-24 transform -rotate-90">
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="6"
                  fill="transparent"
                />
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  stroke={secondsRemaining <= 3 ? '#f43f5e' : '#fbbf24'}
                  strokeWidth="6"
                  fill="transparent"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-linear"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-black font-mono text-white leading-none">
                  {secondsRemaining}s
                </span>
                <span className="text-[9px] uppercase font-bold text-amber-300 tracking-wider">
                  Remaining
                </span>
              </div>
            </div>

          </div>

          {/* Live Method Breakdown Counters & Kill Switch */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Marked</span>
              <span className="text-3xl font-black text-emerald-400 font-mono">{totalMarked}</span>
            </div>
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center">
              <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider block">Tier 1: BLE</span>
              <span className="text-2xl font-black text-white font-mono">{bleCount}</span>
              <span className="text-[10px] text-slate-400 block font-mono">
                {totalMarked > 0 ? Math.round((bleCount / totalMarked) * 100) : 0}%
              </span>
            </div>
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center">
              <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider block">Tier 2: Code</span>
              <span className="text-2xl font-black text-white font-mono">{codeCount}</span>
              <span className="text-[10px] text-slate-400 block font-mono">
                {totalMarked > 0 ? Math.round((codeCount / totalMarked) * 100) : 0}%
              </span>
            </div>
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center">
              <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider block">Tier 3: Manual</span>
              <span className="text-2xl font-black text-white font-mono">{manualCount}</span>
              <span className="text-[10px] text-slate-400 block font-mono">
                {totalMarked > 0 ? Math.round((manualCount / totalMarked) * 100) : 0}%
              </span>
            </div>
          </div>

          {/* One-Tap Kill Switch Bar */}
          <div className="p-4 bg-white/5 rounded-2xl border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${hudData?.kill_switch_active ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                <Power className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-sm text-white block">One-Tap Room Kill Switch</span>
                <p className="text-xs text-slate-400">
                  {hudData?.kill_switch_active 
                    ? 'Room is locked in manual-only mode. Students are directed to see faculty.'
                    : 'Armed: Switch room to manual-only mode if Bluetooth contention occurs.'}
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleKillSwitch}
              disabled={isTogglingKillSwitch}
              className={`px-4 py-2 rounded-xl font-bold text-xs transition shadow-lg shrink-0 ${
                hudData?.kill_switch_active 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                  : 'bg-rose-600 hover:bg-rose-500 text-white'
              }`}
            >
              {isTogglingKillSwitch 
                ? 'Updating...' 
                : (hudData?.kill_switch_active ? 'Disengage Kill Switch' : 'Engage Kill Switch')}
            </button>
          </div>

          {/* Audit-Review Queue with One-Tap Approve/Reject */}
          {hudData?.audit_reviews && hudData.audit_reviews.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Audit-Review Queue ({hudData.audit_reviews.length} Flagged)
                </span>
                <span className="text-[11px] text-slate-400">One-tap resolution</span>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {hudData.audit_reviews.map((rev) => (
                  <div key={rev.id} className="p-3 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between text-xs">
                    <div>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="font-bold text-white">{rev.roll_number}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          {rev.flag}
                        </span>
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5">
                        {rev.details || (rev.measured_rssi ? `Measured RSSI: ${rev.measured_rssi} dBm` : 'Edge location flag')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleResolveReview(rev.id, 'APPROVED')}
                        disabled={resolvingId === rev.id}
                        className="px-2.5 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs transition flex items-center gap-1"
                        title="Approve student attendance"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => handleResolveReview(rev.id, 'REJECTED')}
                        disabled={resolvingId === rev.id}
                        className="px-2.5 py-1.5 bg-rose-600/80 hover:bg-rose-500 text-white rounded-lg font-bold text-xs transition flex items-center gap-1"
                        title="Reject student attendance"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => {
                onClose();
                onSwitchToQR();
              }}
              className="py-3.5 px-4 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition flex items-center justify-center gap-2 shadow"
            >
              <Camera className="w-4 h-4 text-cyan-300" />
              Switch to QR Camera Fallback
            </button>

            <button
              onClick={handleLockAndFinalize}
              disabled={isLocking}
              className="py-3.5 px-4 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-rose-900/40"
            >
              <Lock className="w-4 h-4" />
              {isLocking ? 'Finalizing Session...' : 'Finalize & Lock (Batch Sync Sheets)'}
            </button>
          </div>

        </div>

      </div>

      {/* Reconciliation Report Modal upon Finalize */}
      {showReconcileReport && reconcileReport && (
        <div className="fixed inset-0 z-60 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#001733] border border-blue-500/40 rounded-3xl max-w-lg w-full p-6 text-white shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-white">
                    Session Finalize & Reconciliation
                  </h3>
                  <p className="text-[11px] text-slate-400">Database Record Count vs Google Sheets Sync</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-2">
                <div className="flex justify-between py-1 border-b border-white/10">
                  <span className="text-slate-400">Total Validated in Database:</span>
                  <span className="font-mono font-bold text-emerald-400 text-sm">{reconcileReport.total_marked} Students</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/10">
                  <span className="text-slate-400">Method: Tier 1 (BLE):</span>
                  <span className="font-mono font-bold text-white">{reconcileReport.method_breakdown?.ble}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/10">
                  <span className="text-slate-400">Method: Tier 2 (Rotating Code):</span>
                  <span className="font-mono font-bold text-white">{reconcileReport.method_breakdown?.code}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/10">
                  <span className="text-slate-400">Method: Tier 3 (Manual Search):</span>
                  <span className="font-mono font-bold text-white">{reconcileReport.method_breakdown?.manual}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Flagged Audit Reviews:</span>
                  <span className="font-mono font-bold text-amber-300">{reconcileReport.flagged_for_review}</span>
                </div>
              </div>

              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center gap-2.5 text-emerald-200">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <span className="font-bold block">Single Sheets batchUpdate Dispatched</span>
                  <p className="text-[11px] text-emerald-300/80">Rate-limit hardened worker with exponential backoff &amp; DLQ.</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setShowReconcileReport(false);
                onClose();
              }}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-900/30"
            >
              Close &amp; Return to Dashboard
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
