import React, { useState, useEffect } from 'react';
import { 
  Activity, RefreshCw, Download, AlertTriangle, CheckCircle2, 
  Smartphone, Clock, ShieldAlert, Zap, TrendingDown, Database,
  Sliders, UserX, BarChart2, Info, Monitor, Timer, X
} from 'lucide-react';
import { apiRequest } from '../../services/api';

export const ScannerHealthTab: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [days, setDays] = useState<number>(7);
  const [deviceBucket, setDeviceBucket] = useState<string>('all');
  const [displayType, setDisplayType] = useState<string>('all');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isRollupTriggering, setIsRollupTriggering] = useState(false);
  const [rollupMsg, setRollupMsg] = useState<string | null>(null);
  const [showContractModal, setShowContractModal] = useState<boolean>(false);
  const [contractData, setContractData] = useState<any>(null);
  const [isLoadingContract, setIsLoadingContract] = useState<boolean>(false);

  const fetchHealthMetrics = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      let url = `/telemetry/scanner-health?days=${days}`;
      if (deviceBucket !== 'all') {
        url += `&device_bucket=${deviceBucket}`;
      }
      if (displayType !== 'all') {
        url += `&display_type=${displayType}`;
      }
      const res: any = await apiRequest(url);
      setData(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load scanner health metrics');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthMetrics();
  }, [days, deviceBucket, displayType]);

  const handleTriggerRollup = async () => {
    setIsRollupTriggering(true);
    setRollupMsg(null);
    try {
      const res: any = await apiRequest('/telemetry/trigger-rollup', {
        method: 'POST',
        body: JSON.stringify({ days_back: 3 })
      });
      setRollupMsg(`Rollup succeeded: ${res?.rollup_records_created ?? 0} daily records created.`);
      fetchHealthMetrics();
    } catch (err: any) {
      setRollupMsg(err.message || 'Rollup trigger failed');
    } finally {
      setIsRollupTriggering(false);
    }
  };

  const handleExportCsv = () => {
    const token = localStorage.getItem('snist_auth_token');
    let exportUrl = `/api/v1/telemetry/export-funnel-csv?days=${days}`;
    if (deviceBucket !== 'all') exportUrl += `&device_bucket=${deviceBucket}`;
    if (displayType !== 'all') exportUrl += `&display_type=${displayType}`;
    if (token) exportUrl += `&token=${encodeURIComponent(token)}`;
    window.open(exportUrl, '_blank');
  };

  const fetchContractComparison = async () => {
    setIsLoadingContract(true);
    try {
      const res: any = await apiRequest('/telemetry/contract-comparison');
      setContractData(res);
      setShowContractModal(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load contract comparison');
    } finally {
      setIsLoadingContract(false);
    }
  };

  const headline = data?.headline;
  const funnel = data?.funnel || [];
  const failureMatrix = data?.failure_matrix || {};
  const topError = data?.top_error;
  const manualPath = data?.manual_path;
  const decodeHistogram = data?.decode_histogram;
  const flaggedSessions = manualPath?.flagged_sessions_high_manual || [];

  const formatMs = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined || ms === 0) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="snist-card p-6 bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-3xl border border-slate-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                <Activity className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                  Scanner Health & Failure Forensics
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-400/20 text-cyan-300 border border-cyan-400/30 uppercase tracking-widest">
                    Real Telemetry
                  </span>
                </h2>
                <p className="text-xs text-slate-300">
                  Real classroom client telemetry, drop-off waterfall, error matrix across device tiers, decode histograms, and manual override tracking.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Timeframe Selector */}
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-xs">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
              >
                <option value={1} className="bg-slate-900 text-white">Last 24 Hours</option>
                <option value={7} className="bg-slate-900 text-white">Last 7 Days</option>
                <option value={14} className="bg-slate-900 text-white">Last 14 Days</option>
                <option value={30} className="bg-slate-900 text-white">Last 30 Days</option>
              </select>
            </div>

            {/* Device Tier Filter */}
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-xs">
              <Smartphone className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={deviceBucket}
                onChange={(e) => setDeviceBucket(e.target.value)}
                className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-900 text-white">All Device Tiers</option>
                <option value="old" className="bg-slate-900 text-white">Old Phones (≤Android 9 / ≤2GB)</option>
                <option value="mid" className="bg-slate-900 text-white">Mid Phones</option>
                <option value="new" className="bg-slate-900 text-white">Modern Phones (≥Android 13 / ≥6GB)</option>
              </select>
            </div>

            {/* Display Medium Filter */}
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-xs">
              <Monitor className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={displayType}
                onChange={(e) => setDisplayType(e.target.value)}
                className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-900 text-white">All Display Types</option>
                <option value="projector" className="bg-slate-900 text-white">Projector</option>
                <option value="phone_screen" className="bg-slate-900 text-white">Phone Screen</option>
                <option value="laptop" className="bg-slate-900 text-white">Laptop</option>
              </select>
            </div>

            {/* Refresh */}
            <button
              onClick={fetchHealthMetrics}
              disabled={isLoading}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              title="Refresh telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            {/* Rollup Trigger */}
            <button
              onClick={handleTriggerRollup}
              disabled={isRollupTriggering}
              className="px-3 py-1.5 rounded-xl bg-indigo-600/60 hover:bg-indigo-600 text-white text-xs font-bold border border-indigo-500/40 transition flex items-center gap-1.5"
              title="Run rollup service"
            >
              <Database className={`w-3.5 h-3.5 ${isRollupTriggering ? 'animate-spin' : ''}`} />
              <span>Rollup</span>
            </button>

            {/* Export CSV */}
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 shadow-sm shadow-cyan-500/30"
              title="Export raw funnel CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>

            {/* Contract Verdict */}
            <button
              onClick={fetchContractComparison}
              disabled={isLoadingContract}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm shadow-purple-500/30"
              title="View Week 2 Baseline vs Week 10 Contract Verdict"
            >
              <Sliders className={`w-3.5 h-3.5 ${isLoadingContract ? 'animate-spin' : ''}`} />
              <span>Contract Verdict</span>
            </button>
          </div>
        </div>

        {rollupMsg && (
          <div className="mt-3 text-xs text-indigo-300 bg-indigo-950/80 p-2 rounded-xl border border-indigo-800/60 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{rollupMsg}</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-2xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <span className="text-sm font-medium">{errorMsg}</span>
        </div>
      )}

      {/* Headline Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. First Attempt Success Rate */}
        <div className="snist-card p-5 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>First-Attempt Success</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">
              {headline ? `${headline.first_attempt_success_rate}%` : '—'}
            </span>
            <span className="text-xs text-slate-500">
              {headline ? `(${headline.total_scans_confirmed} / ${headline.total_scans_started})` : ''}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            Percent of scans confirmed on the very first attempt without retry.
          </div>
        </div>

        {/* 2. p50 & p95 Time to Mark */}
        <div className="snist-card p-5 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Latency (p50 / p95)</span>
            <Clock className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {formatMs(headline?.p50_time_to_mark_ms)}
            </span>
            <span className="text-slate-400 font-bold">/</span>
            <span className="text-xl font-bold text-slate-600">
              {formatMs(headline?.p95_time_to_mark_ms)}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            From scan modal open to green confirmation receipt.
          </div>
        </div>

        {/* 3. Old Tier Failure Rate */}
        <div className="snist-card p-5 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Old Phone Failure Rate</span>
            <Smartphone className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-600">
              {headline?.bucket_breakdown?.old ? `${headline.bucket_breakdown.old.rate}%` : '—'}
            </span>
            <span className="text-xs text-slate-500">
              {headline?.bucket_breakdown?.old ? `(${headline.bucket_breakdown.old.failed} failed)` : ''}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            Devices with ≤Android 9, iOS ≤14, or ≤2GB RAM.
          </div>
        </div>

        {/* 4. Manual Override Reliance */}
        <div className="snist-card p-5 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Manual Override Rate</span>
            <UserX className={`w-4 h-4 ${manualPath?.manual_rate_pct > 15 ? 'text-red-500' : 'text-slate-400'}`} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-black ${manualPath?.manual_rate_pct > 15 ? 'text-red-600' : 'text-slate-900'}`}>
              {manualPath ? `${manualPath.manual_rate_pct}%` : '—'}
            </span>
            <span className="text-xs text-slate-500">
              {manualPath ? `(${manualPath.manual_marks_count} marks)` : ''}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            {manualPath?.manual_rate_pct > 15 ? (
              <span className="text-red-600 font-bold">⚠️ Exceeds 15% friction threshold</span>
            ) : (
              'Faculty manual roster mark reliance.'
            )}
          </div>
        </div>
      </div>

      {/* Top Error Forensic Callout */}
      {topError && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-200 text-amber-900 font-bold shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
                Primary Friction Bottleneck
              </div>
              <div className="text-sm font-extrabold text-amber-950 flex items-center gap-2">
                <code className="bg-amber-100 px-2 py-0.5 rounded text-amber-900 text-xs">{topError.error_type}</code>
                <span>— {topError.total_count} incidents recorded</span>
              </div>
            </div>
          </div>
          <div className="text-xs font-semibold bg-amber-200/80 px-3 py-1.5 rounded-xl text-amber-900 w-fit">
            Most impacted tier: <strong className="uppercase">{topError.primary_bucket}</strong>
          </div>
        </div>
      )}

      {/* Funnel Drop-off Waterfall */}
      <div className="snist-card p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[#2f53d7]" />
              QR Scan Funnel Waterfall
            </h3>
            <p className="text-xs text-slate-500">
              Tracking session survival from modal opening through camera activation, decoding, and confirmation.
            </p>
          </div>
          <span className="text-xs font-bold text-slate-400 uppercase">
            Baseline Gate
          </span>
        </div>

        <div className="space-y-3 pt-2">
          {funnel.map((step: any, idx: number) => {
            const prevCount = idx === 0 ? step.count : (funnel[idx - 1]?.count || step.count);
            const dropPct = prevCount > 0 ? Math.max(0, Math.round(((prevCount - step.count) / prevCount) * 100)) : 0;

            return (
              <div key={step.stage} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <span>{step.label}</span>
                    <code className="text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 font-mono">
                      {step.stage}
                    </code>
                  </div>
                  <div className="flex items-center gap-3">
                    {idx > 0 && dropPct > 0 && (
                      <span className="text-rose-500 text-[11px] font-bold flex items-center gap-0.5">
                        <TrendingDown className="w-3 h-3" /> -{dropPct}%
                      </span>
                    )}
                    <span className="font-bold text-slate-900">{step.count} scans</span>
                    <span className="text-slate-400 w-12 text-right">{step.conversion_pct}%</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-[#2f53d7] transition-all duration-500 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(2, step.conversion_pct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Decode Duration Histogram (Week 2 Empirical Timing Forensic) */}
      <div className="snist-card p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Timer className="w-4 h-4 text-emerald-600" />
              Decode Duration Histogram (Camera Frame → QR Decode)
            </h3>
            <p className="text-xs text-slate-500">
              Measures raw client-side JavaScript QR decoding latency per frame stream. Highlights watchdog danger zone (8–15s).
            </p>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-600">
            <span>Decodes: <strong>{decodeHistogram?.total_decodes || 0}</strong></span>
            <span>•</span>
            <span>p50: <strong className="text-indigo-600">{formatMs(decodeHistogram?.p50_decode_ms)}</strong></span>
            <span>•</span>
            <span>p95: <strong className="text-amber-600">{formatMs(decodeHistogram?.p95_decode_ms)}</strong></span>
          </div>
        </div>

        {/* Bracket Breakdown Bars */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 pt-1">
          {[
            { key: '<1s', label: '< 1s', desc: 'Instant', color: 'bg-emerald-500', textCol: 'text-emerald-700', bgCol: 'bg-emerald-50' },
            { key: '1-3s', label: '1 – 3s', desc: 'Optimal', color: 'bg-teal-500', textCol: 'text-teal-700', bgCol: 'bg-teal-50' },
            { key: '3-5s', label: '3 – 5s', desc: 'Acceptable', color: 'bg-blue-500', textCol: 'text-blue-700', bgCol: 'bg-blue-50' },
            { key: '5-8s', label: '5 – 8s', desc: 'Slow (Restart)', color: 'bg-amber-500', textCol: 'text-amber-700', bgCol: 'bg-amber-50' },
            { key: '8-15s', label: '8 – 15s', desc: 'Watchdog Risk', color: 'bg-orange-500', textCol: 'text-orange-700', bgCol: 'bg-orange-50' },
            { key: '>15s', label: '> 15s', desc: 'Timeout Fail', color: 'bg-rose-500', textCol: 'text-rose-700', bgCol: 'bg-rose-50' },
          ].map((bracket) => {
            const count = decodeHistogram?.brackets?.[bracket.key] || 0;
            const total = decodeHistogram?.total_decodes || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;

            return (
              <div key={bracket.key} className={`p-3 rounded-2xl border border-slate-100 ${bracket.bgCol} space-y-2`}>
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-bold ${bracket.textCol}`}>{bracket.label}</span>
                  <span className="text-[10px] text-slate-500">{bracket.desc}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-extrabold text-slate-900">{count}</span>
                  <span className="text-xs font-semibold text-slate-600">{pct}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-200/60 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${bracket.color} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(100, Math.max(pct > 0 ? 8 : 0, pct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Sub-breakdown: Device Tiers comparison */}
        {decodeHistogram?.by_bucket && (
          <div className="pt-2 border-t border-slate-100">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Decode Latency Comparison by Device Tier
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { bucket: 'old', label: 'Old Phones (≤2GB)', color: 'border-amber-200 bg-amber-50/50 text-amber-900' },
                { bucket: 'mid', label: 'Mid Phones (3-4GB)', color: 'border-indigo-200 bg-indigo-50/50 text-indigo-900' },
                { bucket: 'new', label: 'Modern Phones (≥6GB)', color: 'border-emerald-200 bg-emerald-50/50 text-emerald-900' },
              ].map(({ bucket, label, color }) => {
                const bData = decodeHistogram.by_bucket[bucket];
                return (
                  <div key={bucket} className={`p-3 rounded-xl border ${color} flex items-center justify-between text-xs`}>
                    <div>
                      <div className="font-bold">{label}</div>
                      <div className="text-[11px] opacity-75">{bData?.total || 0} decodes</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold">p50: {formatMs(bData?.p50_ms)}</div>
                      <div className="font-mono text-[11px] opacity-80">p95: {formatMs(bData?.p95_ms)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Week 8: Degradation Ladder Usage Forensics (Rungs 1 to 5) */}
      <div className="snist-card p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-indigo-600" />
              Complete Degradation Ladder Usage (Rungs 1 → 5)
            </h3>
            <p className="text-xs text-slate-500">
              Auditing student attendance path transitions through the 5-rung fault-tolerance degradation ladder.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-1.5 text-xs text-indigo-900 font-semibold">
            <span>Ladder Transitions: <strong>{data?.ladder_usage?.total_ladder_events || 0}</strong></span>
          </div>
        </div>

        {/* 5 Rungs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
          {[
            { rung: 1, title: 'Rung 1: WASM Primary', desc: 'Default ZXing-C++ Engine', count: data?.ladder_usage?.rung_1_primary_scan || 0, color: 'border-emerald-200 bg-emerald-50/50 text-emerald-900', badge: 'bg-emerald-600' },
            { rung: 2, title: 'Rung 2: jsQR Fallback', desc: 'Auto Engine Switch', count: data?.ladder_usage?.rung_2_engine_fallback || 0, color: 'border-blue-200 bg-blue-50/50 text-blue-900', badge: 'bg-blue-600' },
            { rung: 3, title: 'Rung 3: Soft Guidance', desc: 'Steady Frame / Zoom Guidance', count: data?.ladder_usage?.rung_3_retry_guidance || 0, color: 'border-amber-200 bg-amber-50/50 text-amber-900', badge: 'bg-amber-600' },
            { rung: 4, title: 'Rung 4: Help / Roll Card', desc: 'One-Tap Roll Number Card', count: data?.ladder_usage?.rung_4_cant_scan_help || 0, color: 'border-purple-200 bg-purple-50/50 text-purple-900', badge: 'bg-purple-600' },
            { rung: 5, title: 'Rung 5: Faculty Manual', desc: 'Audited (M) Roster Mark', count: data?.ladder_usage?.rung_5_faculty_manual || 0, color: 'border-rose-200 bg-rose-50/50 text-rose-900', badge: 'bg-rose-600' },
          ].map((item) => (
            <div key={item.rung} className={`p-3.5 rounded-2xl border ${item.color} space-y-1.5 relative overflow-hidden`}>
              <div className="flex items-center justify-between text-xs">
                <span className={`px-2 py-0.5 rounded text-[10px] text-white font-bold ${item.badge}`}>
                  Rung {item.rung}
                </span>
                <span className="font-extrabold text-lg font-mono">{item.count}</span>
              </div>
              <div className="font-bold text-xs pt-1">{item.title}</div>
              <div className="text-[11px] opacity-75 leading-tight">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Two Column Section: Failure Matrix & Manual Overrides */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Failure Breakdown by Device Tier */}
        <div className="snist-card p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              Failure Matrix by Device Tier
            </h3>
            <p className="text-xs text-slate-500">
              Categorized client-side scan failures cross-referenced against phone performance tiers.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-bold">
                  <th className="py-2.5 px-2">Failure Reason</th>
                  <th className="py-2.5 px-2 text-center text-amber-700">Old</th>
                  <th className="py-2.5 px-2 text-center text-indigo-700">Mid</th>
                  <th className="py-2.5 px-2 text-center text-emerald-700">New</th>
                  <th className="py-2.5 px-2 text-right font-extrabold text-slate-900">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {Object.keys(failureMatrix).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400 italic">
                      No scan failures recorded in this timeframe. All scans succeeded!
                    </td>
                  </tr>
                ) : (
                  Object.entries(failureMatrix).map(([err, counts]: [string, any]) => (
                    <tr key={err} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-2 font-mono text-slate-700">
                        {err}
                      </td>
                      <td className="py-2.5 px-2 text-center text-amber-700 font-bold bg-amber-50/40">
                        {counts.old}
                      </td>
                      <td className="py-2.5 px-2 text-center text-indigo-700 bg-indigo-50/40">
                        {counts.mid}
                      </td>
                      <td className="py-2.5 px-2 text-center text-emerald-700 bg-emerald-50/40">
                        {counts.new}
                      </td>
                      <td className="py-2.5 px-2 text-right font-extrabold text-slate-900">
                        {counts.total}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Manual Path Reliance & High Friction Sessions */}
        <div className="snist-card p-6 bg-white border border-slate-200 rounded-3xl shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                Manual Fallback Forensics
              </h3>
              <p className="text-xs text-slate-500">
                Detecting classroom sessions where teachers abandoned QR scanning due to slow old phones.
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs font-extrabold text-slate-700">
                {manualPath?.manual_searches_count || 0} searches
              </span>
            </div>
          </div>

          {flaggedSessions.length > 0 ? (
            <div className="space-y-3">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  <strong>{flaggedSessions.length} session(s)</strong> had &gt;15% manual overrides, indicating scanner failure in class.
                </span>
              </div>

              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-bold">
                      <th className="py-2 px-2">Session ID</th>
                      <th className="py-2 px-2 text-center">QR Marks</th>
                      <th className="py-2 px-2 text-center">Manual Marks</th>
                      <th className="py-2 px-2 text-right text-rose-600">Manual %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {flaggedSessions.map((s: any) => (
                      <tr key={s.session_id} className="hover:bg-rose-50/30">
                        <td className="py-2 px-2 font-mono text-slate-800">
                          #{s.session_id}
                        </td>
                        <td className="py-2 px-2 text-center text-slate-600">
                          {s.qr_marks}
                        </td>
                        <td className="py-2 px-2 text-center text-amber-700 font-bold">
                          {s.manual_marks}
                        </td>
                        <td className="py-2 px-2 text-right font-black text-rose-600">
                          {s.manual_rate_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs space-y-1">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
              <p className="font-bold text-slate-700">No High-Manual Sessions Detected</p>
              <p>Faculty manual override rate is healthy across all evaluated sessions (&lt;15%).</p>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Overall Manual Reliance:</span>
            <span className="font-extrabold text-slate-800">
              {manualPath?.manual_marks_count || 0} manual / {headline?.total_scans_confirmed || 0} QR marks
            </span>
          </div>
        </div>
      </div>

      {/* Contract Verdict Comparison Modal */}
      {showContractModal && contractData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-4xl w-full p-6 space-y-6 my-8 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-200">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    Week 2 Baseline vs Week 10 Contract Verdict
                  </h3>
                  <p className="text-xs text-slate-500">
                    Empirical performance scorecard measured against frozen institutional contract ({contractData.sample_sizes?.final_total_events || 0} real telemetry events).
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowContractModal(false)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scorecard Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Primary Contract Metrics
              </h4>
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Metric</th>
                      <th className="py-2.5 px-3">Baseline (W2)</th>
                      <th className="py-2.5 px-3">Final (W10)</th>
                      <th className="py-2.5 px-3">Target</th>
                      <th className="py-2.5 px-3">Delta</th>
                      <th className="py-2.5 px-3">Sample (n)</th>
                      <th className="py-2.5 px-3 text-center">Verdict</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {contractData.contract_table?.map((row: any, idx: number) => {
                      const isPass = row.verdict === 'PASS';
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">{row.metric}</td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">{row.baseline_w2}</td>
                          <td className="py-2.5 px-3 font-bold font-mono text-indigo-700">{row.final_w10}</td>
                          <td className="py-2.5 px-3 text-slate-500 font-mono">{row.target}</td>
                          <td className="py-2.5 px-3 font-bold text-emerald-600 font-mono">{row.delta}</td>
                          <td className="py-2.5 px-3 text-slate-400 font-mono">{row.n}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              isPass 
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                                : 'bg-amber-100 text-amber-800 border border-amber-300'
                            }`}>
                              {row.verdict}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Per-Stage Funnel Waterfall */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Funnel Conversion Waterfall: W2 Baseline vs W10 Final
              </h4>
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Funnel Stage</th>
                      <th className="py-2.5 px-3">Baseline Completion %</th>
                      <th className="py-2.5 px-3">Final Completion %</th>
                      <th className="py-2.5 px-3 text-right">Conversion Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {contractData.funnel_waterfall?.map((step: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3 font-semibold text-slate-800">{step.stage}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{step.baseline_pct.toFixed(1)}%</td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">{step.final_pct.toFixed(1)}%</td>
                        <td className="py-2 px-3 font-mono font-bold text-right text-emerald-600">{step.delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer / Close */}
            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowContractModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
              >
                Close Verdict
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

