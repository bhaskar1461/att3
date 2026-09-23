import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  KeyRound,
  X,
  Loader2,
  Lock,
  ArrowRight
} from 'lucide-react';
import {
  getBindingState,
  generateKeyPair,
  readBindingRecord,
  unbindDevice,
  BindingState,
  BindingMetadata,
  DeviceEnrollmentRequestPayload
} from '../services/binding';

interface DeviceEnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnrolled?: (payload: DeviceEnrollmentRequestPayload) => void;
  studentRoll?: string;
  /** Dev-only prop to force a specific state for preview and test verification */
  forcedState?: BindingState;
}

export const DeviceEnrollmentModal: React.FC<DeviceEnrollmentModalProps> = ({
  isOpen,
  onClose,
  onEnrolled,
  studentRoll = '',
  forcedState
}) => {
  const [bindingState, setBindingState] = useState<BindingState>('not_enrolled');
  const [metadata, setMetadata] = useState<BindingMetadata | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (forcedState) {
      setBindingState(forcedState);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const inspectState = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const state = await getBindingState();
        if (!isMounted) return;
        setBindingState(state);

        if (state === 'enrolled') {
          const record = await readBindingRecord();
          if (record && isMounted) {
            setMetadata(record.metadata);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMsg(err.message || 'Failed to inspect device binding state.');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    inspectState();

    return () => {
      isMounted = false;
    };
  }, [isOpen, forcedState]);

  if (!isOpen) return null;

  const handleRegister = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      // Key generation executes silently in ~50ms
      const payload = await generateKeyPair(studentRoll);
      setBindingState('enrolled');
      const record = await readBindingRecord();
      if (record) {
        setMetadata(record.metadata);
      }
      if (onEnrolled) {
        onEnrolled(payload);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Device registration failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUnbind = async () => {
    await unbindDevice();
    setBindingState('not_enrolled');
    setMetadata(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
        {/* Header gradient band */}
        <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 via-indigo-500 to-sky-400" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-full transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm font-medium text-slate-400">Inspecting device security status...</p>
            </div>
          ) : (
            <>
              {/* ============================================================ */}
              {/* STATE 1: NOT ENROLLED */}
              {/* ============================================================ */}
              {bindingState === 'not_enrolled' && (
                <div className="space-y-5">
                  <div className="flex items-center space-x-3.5">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-tight">Register this Device</h3>
                      <p className="text-xs text-slate-400">Institutional Device Binding</p>
                    </div>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">
                    Link this phone to your student account for fast, proxy-free attendance. Your browser
                    creates a private cryptographic key that never leaves this hardware.
                  </p>

                  <div className="p-3.5 space-y-2 rounded-xl bg-slate-800/40 border border-slate-800 text-xs text-slate-400">
                    <div className="flex items-center space-x-2 text-slate-300 font-medium">
                      <Lock className="w-4 h-4 text-blue-400 shrink-0" />
                      <span>Zero Plaintext Credentials Transmitted</span>
                    </div>
                    <p className="leading-normal">
                      Attendance marks will only be verified from your registered device. Registration takes ~50 milliseconds.
                    </p>
                  </div>

                  {errorMsg && (
                    <div className="p-3 text-xs text-rose-400 rounded-lg bg-rose-500/10 border border-rose-500/20">
                      {errorMsg}
                    </div>
                  )}

                  <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={handleRegister}
                      disabled={isGenerating}
                      className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-sm shadow-lg shadow-blue-500/25 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Generating Key...</span>
                        </>
                      ) : (
                        <>
                          <span>Register Device</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                    <button
                      onClick={onClose}
                      disabled={isGenerating}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 text-slate-300 font-medium text-sm transition-colors"
                    >
                      Not now
                    </button>
                  </div>
                  <p className="text-[11px] text-center text-slate-500">
                    Selecting "Not now" leaves your device unbound. Attendance scans will be rejected at the security gate.
                  </p>
                </div>
              )}

              {/* ============================================================ */}
              {/* STATE 2: ENROLLED */}
              {/* ============================================================ */}
              {bindingState === 'enrolled' && (
                <div className="space-y-5">
                  <div className="flex items-center space-x-3.5">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                      <CheckCircle className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-tight">Device Bound</h3>
                      <p className="text-xs text-emerald-400 font-medium">Hardware-Locked Key Active</p>
                    </div>
                  </div>

                  <p className="text-sm text-slate-300">
                    This browser holds an active non-extractable attendance key. Attendance scans are authorized for your account.
                  </p>

                  <div className="p-3.5 space-y-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs">
                    <div className="flex justify-between items-center text-slate-400">
                      <span>Key Identifier:</span>
                      <span className="font-mono text-slate-200 font-semibold">
                        {metadata?.key_id ? `${metadata.key_id.slice(0, 8)}...${metadata.key_id.slice(-8)}` : 'ACTIVE_KEY'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-400">
                      <span>Enrolled On:</span>
                      <span className="text-slate-200">
                        {metadata?.enrolled_at ? new Date(metadata.enrolled_at).toLocaleDateString() : 'Active'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-400">
                      <span>Storage Persistence:</span>
                      <span className={metadata?.storage_persisted ? 'text-emerald-400 font-medium' : 'text-amber-400'}>
                        {metadata?.storage_persisted ? 'Persisted (Protected)' : 'Standard (LRU)'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={onClose}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm transition-colors"
                    >
                      Done
                    </button>
                    <button
                      onClick={handleUnbind}
                      className="px-3 py-2.5 rounded-xl text-xs text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-colors"
                    >
                      Revoke Binding
                    </button>
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* STATE 3: INCOMPLETE (Storage Divergence) */}
              {/* ============================================================ */}
              {bindingState === 'incomplete' && (
                <div className="space-y-5">
                  <div className="flex items-center space-x-3.5">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                      <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-tight">Verification Incomplete</h3>
                      <p className="text-xs text-amber-400 font-medium">Storage Divergence Detected</p>
                    </div>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">
                    Browser data was partially cleared or storage pressure evicted your security key handle.
                    To resume taking attendance on this device, re-enroll your keypair.
                  </p>

                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                    Re-enrolling generates a fresh cryptographic signature key and restores synchronized security tokens.
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={handleRegister}
                      disabled={isGenerating}
                      className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm transition-colors"
                    >
                      {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Re-register Device</span>}
                    </button>
                    <button
                      onClick={onClose}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* STATE 4: UNSUPPORTED BROWSER */}
              {/* ============================================================ */}
              {bindingState === 'unsupported' && (
                <div className="space-y-5">
                  <div className="flex items-center space-x-3.5">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                      <AlertOctagon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-tight">Browser Not Supported</h3>
                      <p className="text-xs text-rose-400 font-medium">SubtleCrypto ECDSA Absent</p>
                    </div>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">
                    This browser engine lacks standard Web Crypto support for hardware-backed keys.
                  </p>

                  <div className="p-3.5 space-y-2 rounded-xl bg-slate-800/60 border border-slate-700 text-xs text-slate-300">
                    <p className="font-semibold text-white">Recommended Actions:</p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400">
                      <li>Open SNIST ERP in Google Chrome (v70+) or Safari (iOS 12+).</li>
                      <li>Update Android System WebView via Google Play Store.</li>
                      <li>For classroom assistance, request manual attendance via faculty (Ladder Rung 5).</li>
                    </ol>
                  </div>

                  <button
                    onClick={onClose}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm transition-colors"
                  >
                    I Understand
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
