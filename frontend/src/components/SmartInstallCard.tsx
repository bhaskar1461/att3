import React, { useState } from 'react';
import { Download, PlusSquare, Share2, X, Sparkles } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

/**
 * SmartInstallCard — Contextual Post-Login / Post-Scan PWA Promotion
 * 
 * Rules:
 * A. Standalone -> render null
 * B. Android Chrome w/ beforeinstallprompt -> single dismissible card with [Install ERP] button
 * C. iOS Safari -> concise 3-step Add to Home Screen instructions
 * D. Unsupported -> render null
 * 
 * Dismissal is permanently persisted in localStorage.
 * Never shown on page load of login, never shown during scanning.
 */
export const SmartInstallCard: React.FC = () => {
  const {
    isStandalone,
    platform,
    browser,
    canInstallPrompt,
    isInstalling,
    promptInstall,
  } = usePwaInstall();

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pwa_smart_card_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem('pwa_smart_card_dismissed', 'true');
    } catch {}
  };

  // A. If already running in standalone mode, or dismissed, show nothing
  if (isStandalone || dismissed) {
    return null;
  }

  // B. Android Chrome / supported browsers with prompt captured
  const isAndroidSupported = platform === 'android' || canInstallPrompt;

  // C. iOS Safari (Apple restricts PWA addition exclusively to Safari)
  const isIosSafari = platform === 'ios' && browser === 'safari';

  // D. Unsupported environment -> show nothing
  if (!isAndroidSupported && !isIosSafari) {
    return null;
  }

  return (
    <div className="w-full bg-gradient-to-r from-[#001e40] to-[#0a2e5c] text-white rounded-2xl p-4 shadow-md border border-blue-900/40 relative animate-in fade-in slide-in-from-top-2 font-sans">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install recommendation"
        className="absolute top-3 right-3 p-1 rounded-lg text-blue-300 hover:text-white transition cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#08142c] p-1 shrink-0 border border-amber-400/40 shadow-sm flex items-center justify-center">
          <img src="/apple-touch-icon.png" alt="SNIST Icon" className="w-full h-full object-contain rounded-lg" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-white tracking-tight">Add SNIST ERP to Home Screen</h4>
            <span className="text-[9px] bg-amber-400 text-slate-950 font-black px-1.5 py-0.5 rounded-full uppercase leading-none">
              Optional
            </span>
          </div>
          <p className="text-xs text-blue-200 mt-1 leading-relaxed">
            {isIosSafari
              ? 'Get instant 1-tap launch and full-screen attendance scanning with no browser bars.'
              : 'Install the web app to your device for instant 1-tap launch during attendance.'}
          </p>

          {isAndroidSupported && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => promptInstall()}
                disabled={isInstalling}
                className="py-2 px-3.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 rounded-xl text-xs font-black transition shadow active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isInstalling ? 'Opening...' : 'Install ERP App'}</span>
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="py-2 px-3 text-xs font-semibold text-blue-200 hover:text-white transition cursor-pointer"
              >
                Maybe Later
              </button>
            </div>
          )}

          {isIosSafari && (
            <div className="mt-3 bg-white/10 rounded-xl p-2.5 text-xs text-blue-100 space-y-1 border border-white/10">
              <p className="font-bold text-white text-[11px] uppercase tracking-wider mb-1">3-Step Setup:</p>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-4 h-4 rounded-full bg-amber-400 text-slate-950 font-black flex items-center justify-center text-[10px] shrink-0">1</span>
                <span>Tap Safari's Share button <Share2 className="w-3 h-3 inline text-blue-200" /> in bottom toolbar</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-4 h-4 rounded-full bg-amber-400 text-slate-950 font-black flex items-center justify-center text-[10px] shrink-0">2</span>
                <span>Select <strong>"Add to Home Screen"</strong> <PlusSquare className="w-3 h-3 inline text-blue-200" /></span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-4 h-4 rounded-full bg-amber-400 text-slate-950 font-black flex items-center justify-center text-[10px] shrink-0">3</span>
                <span>Tap <strong>"Add"</strong> in top-right</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
