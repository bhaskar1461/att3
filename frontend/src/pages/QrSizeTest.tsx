import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { 
  CheckCircle, XCircle, ArrowRight, RotateCcw, Tv, Laptop, 
  Smartphone, Maximize2, Minimize2, ShieldCheck, HelpCircle, 
  Sparkles, Moon, Sun, ArrowLeft
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface SizeLevel {
  id: number;
  label: string;
  sizePx: number;
  physicalCmEstimate: string;
  targetDistance: string;
  description: string;
}

const SIZE_LEVELS: SizeLevel[] = [
  { id: 1, label: 'Level 1: Compact (15cm)', sizePx: 200, physicalCmEstimate: '~15 cm', targetDistance: '1.0 – 1.5 m', description: 'Faculty laptop desk check or small seminar display' },
  { id: 2, label: 'Level 2: Standard (30cm)', sizePx: 320, physicalCmEstimate: '~30 cm', targetDistance: '2.0 – 3.0 m', description: 'Front-row to mid-row classroom projection' },
  { id: 3, label: 'Level 3: Medium (50cm)', sizePx: 480, physicalCmEstimate: '~50 cm', targetDistance: '3.5 – 5.0 m', description: 'Standard classroom (40–60 students) back-row coverage' },
  { id: 4, label: 'Level 4: Large (75cm)', sizePx: 640, physicalCmEstimate: '~75 cm', targetDistance: '5.0 – 7.0 m', description: 'Large tier hall (60–100 students) back-row coverage' },
  { id: 5, label: 'Level 5: Maximum (100cm)', sizePx: 820, physicalCmEstimate: '~100 cm', targetDistance: '7.0 – 9.0 m', description: 'Full auditorium or ultra-wide lecture hall back-row' },
];

export const QrSizeTest: React.FC = () => {
  const [currentLevelIdx, setCurrentLevelIdx] = useState<number>(0);
  const [testResults, setTestResults] = useState<Record<number, boolean>>({});
  const [isDarkRoom, setIsDarkRoom] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [roomName, setRoomName] = useState<string>('Room 204');
  const [displayType, setDisplayType] = useState<'projector' | 'laptop' | 'phone_screen'>('projector');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentLevel = SIZE_LEVELS[currentLevelIdx];
  const testPayload = `?s=CALIB001&v=${currentLevel.id}`;

  // Render QR Code onto Canvas whenever level or dark mode changes
  useEffect(() => {
    if (!canvasRef.current || isCompleted) return;

    QRCode.toCanvas(
      canvasRef.current,
      testPayload,
      {
        errorCorrectionLevel: 'L', // ECC L per Week 5 specification
        margin: 4,                // Spec-mandated 4-module quiet zone
        scale: Math.max(4, Math.floor(currentLevel.sizePx / 29)),
        color: {
          dark: isDarkRoom ? '#ffffff' : '#000000',
          light: isDarkRoom ? '#000000' : '#ffffff',
        },
      },
      (err) => {
        if (err) console.error('Failed to render calibration QR:', err);
      }
    );
  }, [currentLevelIdx, isDarkRoom, isCompleted]);

  const recordResult = (passed: boolean) => {
    const updated = { ...testResults, [currentLevel.id]: passed };
    setTestResults(updated);

    if (currentLevelIdx < SIZE_LEVELS.length - 1) {
      setCurrentLevelIdx(currentLevelIdx + 1);
    } else {
      setIsCompleted(true);
    }
  };

  const restartTest = () => {
    setCurrentLevelIdx(0);
    setTestResults({});
    setIsCompleted(false);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Compute recommended minimum size
  const passingLevels = SIZE_LEVELS.filter((lvl) => testResults[lvl.id] === true);
  const minPassingLevel = passingLevels.length > 0 ? passingLevels[0] : null;

  return (
    <div 
      ref={containerRef}
      className={`min-h-screen p-4 sm:p-8 flex flex-col justify-between transition-colors duration-300 font-sans ${
        isDarkRoom ? 'bg-[#000000] text-white' : 'bg-[#0f172a] text-white'
      }`}
    >
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/teacher" className="text-slate-400 hover:text-white text-xs font-bold flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
            <span className="text-slate-500">•</span>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-mono font-bold">
              FACULTY ROOM CALIBRATION
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight mt-1">
            Classroom QR Size & Readability Test Tool
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Calibrate the minimum readable QR dimensions for your lecture hall's projector from back-row seats.
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Dark Room Inverted Toggle */}
          <button
            onClick={() => setIsDarkRoom(!isDarkRoom)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border ${
              isDarkRoom 
                ? 'bg-purple-600/40 text-purple-200 border-purple-400' 
                : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
            }`}
            title="Toggle White-on-Black inverted mode for dimmed rooms"
          >
            {isDarkRoom ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-purple-300" />}
            <span>{isDarkRoom ? 'Light Mode' : 'Dark-Room Inverted'}</span>
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/15"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center my-6">
        {!isCompleted ? (
          <div className="flex flex-col items-center max-w-3xl w-full text-center space-y-6">
            
            {/* Step Indicator */}
            <div className="flex items-center justify-center gap-2">
              {SIZE_LEVELS.map((lvl, idx) => (
                <div 
                  key={lvl.id}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold transition-all ${
                    idx === currentLevelIdx 
                      ? 'bg-amber-500 text-slate-950 scale-105 shadow-md'
                      : testResults[lvl.id] === true
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : testResults[lvl.id] === false
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-white/5 text-slate-500'
                  }`}
                >
                  <span>{lvl.id}</span>
                  <span className="hidden md:inline">{lvl.physicalCmEstimate}</span>
                </div>
              ))}
            </div>

            {/* Instruction Card */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 max-w-xl text-left text-xs sm:text-sm text-slate-300 space-y-1">
              <strong className="text-white block text-sm font-bold flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Faculty Action for {currentLevel.label}:
              </strong>
              <p>
                1. Project this test on your screen or laptop.
              </p>
              <p>
                2. Walk to your classroom's back row (approx. <strong>{currentLevel.targetDistance}</strong>).
              </p>
              <p>
                3. Open your student portal scanner. Can your phone camera lock on and decode within 2 seconds?
              </p>
            </div>

            {/* The Crisp Optical QR Matrix at Target Level Scale */}
            <div 
              className={`relative flex items-center justify-center p-4 rounded-3xl transition-all duration-300 ${
                isDarkRoom ? 'bg-black border-2 border-white/30' : 'bg-white shadow-2xl'
              }`}
              style={{
                width: `${Math.min(currentLevel.sizePx, 720)}px`,
                height: `${Math.min(currentLevel.sizePx, 720)}px`,
                maxWidth: '90vw',
                maxHeight: '55vh'
              }}
            >
              <canvas 
                ref={canvasRef} 
                className="w-full h-full object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>

            {/* Verification Prompt Buttons */}
            <div className="space-y-3 w-full max-w-md">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Did your phone decode this code from the back row?
              </span>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => recordResult(false)}
                  className="py-3 px-4 bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/50 text-rose-200 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow"
                >
                  <XCircle className="w-5 h-5 text-rose-400" />
                  <span>FAIL (Too Far / Blur)</span>
                </button>

                <button
                  onClick={() => recordResult(true)}
                  className="py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg"
                >
                  <CheckCircle className="w-5 h-5 text-white" />
                  <span>PASS (Decoded Easily)</span>
                </button>
              </div>
            </div>

          </div>
        ) : (
          /* Calibration Verdict & Recommendation Report */
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-10 max-w-2xl w-full text-center space-y-6 shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
              <ShieldCheck className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Room Calibration Complete!
              </h2>
              <p className="text-sm text-slate-300">
                Here are the empirical optical thresholds determined for this display:
              </p>
            </div>

            {/* Recommendation Box */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-5 text-left space-y-3 font-mono text-xs sm:text-sm">
              <div className="flex justify-between items-center border-b border-white/10 pb-2">
                <span className="text-slate-400">Minimum Effective Size:</span>
                <strong className="text-emerald-400 font-bold text-base">
                  {minPassingLevel ? minPassingLevel.label : 'Level 5 (Max 100cm Required)'}
                </strong>
              </div>

              <div className="flex justify-between items-center border-b border-white/10 pb-2">
                <span className="text-slate-400">Target Read Range:</span>
                <span className="text-white font-semibold">
                  {minPassingLevel ? minPassingLevel.targetDistance : 'Front 4m only'}
                </span>
              </div>

              <div className="flex justify-between items-center border-b border-white/10 pb-2">
                <span className="text-slate-400">Recommended Display Mode:</span>
                <span className="text-amber-300 font-bold">
                  {minPassingLevel && minPassingLevel.id <= 2 
                    ? 'Standard Layout is Sufficient' 
                    : 'Fullscreen Presentation Mode (92-96% Display) Required'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-400">Dark-Room Optimization:</span>
                <span className="text-purple-300">
                  {isDarkRoom ? 'Enabled (Recommended for low light)' : 'Optional'}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-left text-xs text-amber-200">
              💡 <strong>Faculty Advice:</strong> During live lectures, toggle into <strong>Presentation Mode</strong> (or press F11). Our edge-to-edge rendering automatically expands the QR code to 92–96% of the projector screen with a 4-module quiet zone, ensuring even older budget phones decode reliably.
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
              <button
                onClick={restartTest}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 border border-white/15"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Re-run Calibration</span>
              </button>

              <Link
                to="/teacher"
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg"
              >
                <span>Return to Teacher Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}
      </main>

      {/* Slim Institutional Footer */}
      <footer className="text-center text-xs text-slate-500 font-mono border-t border-white/5 pt-3">
        SNIST ERP • Optical Calibration Suite • Week 5 QR Presentation Tuning
      </footer>
    </div>
  );
};
