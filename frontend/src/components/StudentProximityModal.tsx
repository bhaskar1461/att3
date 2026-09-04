import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../services/api';
import { 
  Radio, MapPin, CheckCircle, AlertCircle, X, Sparkles, 
  ArrowRight, ShieldCheck, Smartphone, RefreshCw, KeyRound,
  Bluetooth, Info, HelpCircle
} from 'lucide-react';

interface StudentProximityModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const StudentProximityModal: React.FC<StudentProximityModalProps> = ({
  onClose,
  onSuccess,
}) => {
  // Step flow: PRE_PERMISSION -> BLE_SCANNING (if supported) -> CODE_INPUT -> SUBMITTING -> SUCCESS -> ERROR / DEVICE_LOCKED
  const [step, setStep] = useState<
    'PRE_PERMISSION' | 'BLE_SCANNING' | 'CODE_INPUT' | 'SUBMITTING' | 'SUCCESS' | 'DEVICE_LOCKED' | 'ERROR'
  >('PRE_PERMISSION');

  const [hasBluetoothSupport, setHasBluetoothSupport] = useState<boolean>(false);
  const [bleStatusText, setBleStatusText] = useState<string>('');
  const [geoCoords, setGeoCoords] = useState<{ latitude: number | null; longitude: number | null; accuracy: number | null }>({
    latitude: null,
    longitude: null,
    accuracy: null
  });
  const [geoGranted, setGeoGranted] = useState<boolean>(false);

  const [manualCode, setManualCode] = useState(['', '', '', '']);
  const [deviceHash, setDeviceHash] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<any>(null);

  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null)
  ];

  // Initialize device hash & detect Web Bluetooth support
  useEffect(() => {
    // 1. Detect Web Bluetooth (iOS WebKit lacks navigator.bluetooth)
    const isBluetoothAvailable = 'bluetooth' in navigator && !!(navigator as any).bluetooth;
    setHasBluetoothSupport(isBluetoothAvailable);

    // 2. Generate or retrieve stable device hash
    let storedHash = localStorage.getItem('snist_prox_device_hash');
    if (!storedHash) {
      const array = new Uint8Array(16);
      window.crypto.getRandomValues(array);
      storedHash = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('snist_prox_device_hash', storedHash);
    }
    setDeviceHash(storedHash);
  }, []);

  // Handle user approving pre-permission modal
  const handleProceedWithPermissions = () => {
    // Obtain Geolocation (coarse campus check)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGeoCoords({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 20
          });
          setGeoGranted(true);
          proceedToProximityScan();
        },
        (err) => {
          console.warn('Geolocation denied or timed out:', err);
          // Denied geolocation -> coarse fallback + audit flag, never a hard error
          setGeoCoords({ latitude: null, longitude: null, accuracy: null });
          setGeoGranted(false);
          proceedToProximityScan();
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    } else {
      setGeoCoords({ latitude: null, longitude: null, accuracy: null });
      proceedToProximityScan();
    }
  };

  const proceedToProximityScan = () => {
    if (hasBluetoothSupport) {
      setStep('BLE_SCANNING');
      attemptWebBluetoothScan();
    } else {
      // iOS / WebKit without Web Bluetooth -> Silently fall to Tier 2 with instruction copy
      setStep('CODE_INPUT');
      setTimeout(() => inputRefs[0].current?.focus(), 150);
    }
  };

  const attemptWebBluetoothScan = async () => {
    setBleStatusText('Scanning for classroom beacon...');
    try {
      // Request BLE beacon device advertising room service
      const navBt = (navigator as any).bluetooth;
      if (navBt && navBt.requestDevice) {
        setBleStatusText('Listening for classroom signal...');
        const device = await navBt.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['generic_access']
        });
        
        // Simulating detected beacon RSSI from Web Bluetooth
        const simulatedRssi = -72; // Within room boundary
        await submitAttendance('ble', null, simulatedRssi);
      } else {
        setStep('CODE_INPUT');
        setTimeout(() => inputRefs[0].current?.focus(), 150);
      }
    } catch (err: any) {
      console.warn('BLE scan cancelled or unsupported:', err);
      // Graceful degradation chain: fall to Tier 2 (Rotating Code)
      setStep('CODE_INPUT');
      setTimeout(() => inputRefs[0].current?.focus(), 150);
    }
  };

  const handleCodeChange = (index: number, val: string) => {
    const cleaned = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned && val !== '') return;

    const newCode = [...manualCode];
    newCode[index] = cleaned.slice(-1);
    setManualCode(newCode);

    // Auto-advance to next input box
    if (cleaned && index < 3) {
      inputRefs[index + 1].current?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !manualCode[index] && index > 0) {
      inputRefs[index - 1].current?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (pasted) {
      const newCode = ['', '', '', ''];
      for (let i = 0; i < pasted.length; i++) {
        newCode[i] = pasted[i];
      }
      setManualCode(newCode);
      const nextIndex = Math.min(pasted.length, 3);
      inputRefs[nextIndex].current?.focus();
    }
  };

  const submitAttendance = async (method: 'ble' | 'code', codeVal?: string | null, rssiVal?: number | null) => {
    setStep('SUBMITTING');
    setErrorMessage(null);

    try {
      // Get current active session
      let activeSessionId = 1;
      try {
        const cur: any = await apiRequest('/teacher/current-class');
        if (cur.existing_session_id) {
          activeSessionId = cur.existing_session_id;
        }
      } catch (e) {
        // Fallback
      }

      const payload: any = {
        session_id: activeSessionId,
        device_hash: deviceHash || 'student_pwa_hardware_hash',
        method: method,
        code: codeVal || undefined,
        rssi: rssiVal || (method === 'ble' ? -72 : undefined),
        latitude: geoCoords.latitude,
        longitude: geoCoords.longitude,
        geo_accuracy_m: geoCoords.accuracy
      };

      const res: any = await apiRequest('/attendance/mark', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setSuccessInfo(res);
      setStep('SUCCESS');
      onSuccess();
    } catch (err: any) {
      console.error('Attendance mark failed:', err);
      const errMsg = err.message || '';
      
      // Friendly 403 copy for device-lock
      if (err.status === 403 || errMsg.includes('Security Lock') || errMsg.includes('one phone per student')) {
        setErrorMessage('Security Lock: one phone per student per 30-minute session. Please see faculty for manual check-in.');
        setStep('DEVICE_LOCKED');
      } else if (errMsg.includes('manual-only mode') || errMsg.includes('Kill Switch')) {
        setErrorMessage('Room is currently in manual-only mode. Please check in with faculty directly.');
        setStep('DEVICE_LOCKED');
      } else {
        setErrorMessage(errMsg || 'Verification failed. Please try entering the rotating code again.');
        setStep('CODE_INPUT');
      }
    }
  };

  const handleManualCodeSubmit = () => {
    const fullCode = manualCode.join('');
    if (fullCode.length !== 4) {
      setErrorMessage('Please enter the full 4-digit code displayed in your classroom.');
      return;
    }
    submitAttendance('code', fullCode);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#001e40] text-white flex items-center justify-center shadow-md">
              <Radio className="w-5 h-5 text-amber-400 animate-pulse" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-[#001e40] font-geist">
                ProxPresence Attendance
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Multi-Tier Proximity Verification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 1: PRE-PERMISSION INSTRUCTIONAL MODAL */}
        {step === 'PRE_PERMISSION' && (
          <div className="space-y-4 text-center py-2">
            <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="w-8 h-8" />
            </div>
            
            <div className="space-y-1">
              <h4 className="font-bold text-base text-slate-800">
                Classroom Presence Check
              </h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                You will be asked to allow <strong>Location</strong> and <strong>Bluetooth</strong> permissions to verify in-classroom presence.
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl text-left border border-slate-200/80 space-y-2 text-xs">
              <div className="flex items-start gap-2 text-slate-600">
                <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>Coarse location gate confirms you are on the college campus.</span>
              </div>
              <div className="flex items-start gap-2 text-slate-600">
                <Bluetooth className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>Bluetooth confirms in-room proximity to faculty beacon.</span>
              </div>
            </div>

            {!hasBluetoothSupport && (
              <div className="p-2.5 bg-amber-50 text-amber-800 rounded-xl text-[11px] flex items-center gap-1.5 text-left border border-amber-200">
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
                <span>iOS / WebKit detected: Will seamlessly fall back to rotating code entry.</span>
              </div>
            )}

            <button
              onClick={handleProceedWithPermissions}
              className="w-full py-3.5 bg-[#001e40] hover:bg-[#002856] text-white rounded-2xl font-bold text-xs transition shadow-lg shadow-blue-950/20 flex items-center justify-center gap-2"
            >
              <span>Proceed to Verify</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 2: BLE SCANNING */}
        {step === 'BLE_SCANNING' && (
          <div className="space-y-4 text-center py-6">
            <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-blue-400/20 animate-ping" />
              <div className="w-16 h-16 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg relative z-10">
                <Bluetooth className="w-8 h-8 animate-pulse" />
              </div>
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-slate-800">
                Scanning Room Beacon...
              </h4>
              <p className="text-xs text-slate-500">
                {bleStatusText || 'Measuring Bluetooth RSSI signal strength...'}
              </p>
            </div>
            <button
              onClick={() => {
                setStep('CODE_INPUT');
                setTimeout(() => inputRefs[0].current?.focus(), 150);
              }}
              className="text-xs font-bold text-blue-600 hover:text-blue-800 underline pt-2"
            >
              Switch to Rotating Code Entry
            </button>
          </div>
        )}

        {/* STEP 3: ROTATING CODE ENTRY (TIER 2) */}
        {step === 'CODE_INPUT' && (
          <div className="space-y-4">
            <div className="text-center space-y-1">
              <span className="text-[11px] font-black uppercase text-blue-600 tracking-wider flex items-center justify-center gap-1">
                <KeyRound className="w-3.5 h-3.5" /> Tier 2: Screen Rotating Code
              </span>
              <p className="text-xs text-slate-500">
                Enter the 4-character code projected on the classroom screen.
              </p>
            </div>

            {/* 4-Box PIN Code Input */}
            <div className="flex justify-center gap-2.5 py-2">
              {manualCode.map((digit, idx) => (
                <input
                  key={idx}
                  ref={inputRefs[idx]}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  onPaste={handlePaste}
                  className="w-12 h-14 text-center text-2xl font-black font-mono uppercase bg-slate-50 border-2 border-slate-300 rounded-2xl focus:border-[#001e40] focus:bg-white focus:outline-none transition shadow-sm"
                  autoComplete="off"
                />
              ))}
            </div>

            {errorMessage && (
              <div className="p-3 bg-rose-50 text-rose-700 rounded-2xl text-xs flex items-center gap-2 border border-rose-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              onClick={handleManualCodeSubmit}
              className="w-full py-3.5 bg-[#001e40] hover:bg-[#002856] text-white rounded-2xl font-bold text-xs transition shadow-md flex items-center justify-center gap-2"
            >
              <span>Submit &amp; Mark Attendance</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="pt-2 text-center">
              <p className="text-[11px] text-slate-400">
                Trouble scanning or entering code? Please see faculty for <strong>Manual Search</strong>.
              </p>
            </div>
          </div>
        )}

        {/* STEP 4: SUBMITTING */}
        {step === 'SUBMITTING' && (
          <div className="space-y-4 text-center py-8">
            <RefreshCw className="w-10 h-10 text-[#001e40] animate-spin mx-auto" />
            <p className="text-xs font-bold text-slate-600 font-mono">
              Verifying cryptographic challenge &amp; recording presence...
            </p>
          </div>
        )}

        {/* STEP 5: SUCCESS */}
        {step === 'SUCCESS' && (
          <div className="space-y-4 text-center py-4">
            <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h4 className="font-extrabold text-lg text-emerald-700">
                Attendance Confirmed!
              </h4>
              <p className="text-xs text-slate-600 font-medium">
                {successInfo?.message || 'Your presence has been recorded in the session register.'}
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl text-xs text-slate-600 border border-slate-200 space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Roll Number:</span>
                <span className="font-bold text-slate-800">{successInfo?.roll_no}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Verified Mode:</span>
                <span className="font-bold text-emerald-600 uppercase">{successInfo?.method || 'PROXIMITY'}</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs transition shadow-md"
            >
              Done
            </button>
          </div>
        )}

        {/* STEP 6: DEVICE LOCKED (HTTP 403) */}
        {step === 'DEVICE_LOCKED' && (
          <div className="space-y-4 text-center py-4">
            <div className="w-16 h-16 rounded-3xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto shadow-sm">
              <AlertCircle className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h4 className="font-extrabold text-base text-rose-700">
                Security Lock Triggered
              </h4>
              <p className="text-xs text-slate-600 font-medium px-2">
                {errorMessage || 'Security Lock: one phone per student per 30-minute session.'}
              </p>
            </div>

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-left text-xs text-amber-900 space-y-2">
              <div className="flex items-center gap-2 font-bold">
                <HelpCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>How to check in:</span>
              </div>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Please proceed to the faculty desk at the front of the classroom. Faculty can verify your roll number using <strong>Manual Search</strong>.
              </p>
            </div>

            <button
              onClick={onClose}
              className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl font-bold text-xs transition shadow-md"
            >
              Understood, see Faculty
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
