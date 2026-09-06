import React, { useState } from 'react';
import { Share, Copy, Check, ExternalLink, ShieldAlert } from 'lucide-react';
import { detectPlatform } from '../services/telemetryService';

/**
 * iOS Non-Safari Interstitial — Day 1 Failure Prevention
 *
 * Problem: On iPhones, Apple ONLY supports true standalone PWA installation via Safari.
 * Students opening the portal in Chrome or Brave on iOS cannot install the app properly.
 * 
 * Solution: Full-screen non-dismissible interstitial instructing the student to copy
 * the URL and open it in Safari.
 */
export const IosSafariInterstitial: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { platform, browser, isStandalone } = detectPlatform();

  // If dismissed, or already running in standalone mode, or if not iOS, or if running in Safari, do not block
  if (dismissed || isStandalone || platform !== 'ios' || browser === 'safari') {
    return null;
  }

  const portalUrl = window.location.origin;

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(portalUrl);
      } else {
        // Fallback for older WebViews
        const textArea = document.createElement('textarea');
        textArea.value = portalUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setCopied(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white text-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col font-sans border border-slate-200">
        
        {/* Header */}
        <div className="bg-[#15347e] text-white px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-400 text-[#15347e] flex items-center justify-center font-black shrink-0 shadow">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-extrabold text-base leading-tight">Action Required on iPhone</h2>
            <p className="text-xs text-blue-200 mt-0.5">Please open this page in Safari</p>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 leading-relaxed font-medium">
            You are currently using <strong>{browser.toUpperCase()}</strong> on iOS. Apple security policies require using <strong>Safari</strong> to install the SNIST Attendance App on your home screen.
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Quick Setup in Safari (10 seconds):</p>
            
            <div className="space-y-2.5 text-xs text-slate-700">
              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="w-5 h-5 rounded-full bg-[#15347e] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">1</div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Copy the portal URL below</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Tap the blue button to copy link</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="w-5 h-5 rounded-full bg-[#15347e] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">2</div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Open the built-in Safari browser</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Paste the link into Safari address bar</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="w-5 h-5 rounded-full bg-[#15347e] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">3</div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                    Tap the Share button <Share className="w-3.5 h-3.5 text-blue-600 inline" />
                  </p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Located at the bottom center of Safari</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="w-5 h-5 rounded-full bg-[#15347e] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">4</div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Tap "Add to Home Screen"</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Open the app from your home screen to mark attendance</p>
                </div>
              </div>
            </div>
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopyLink}
            className={`w-full py-3.5 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] ${
              copied
                ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                : 'bg-[#15347e] text-white hover:bg-[#102766] shadow-[#15347e]/30'
            }`}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" /> Link Copied! Now Open Safari
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> Copy Portal Link
              </>
            )}
          </button>

          <p className="text-[11px] text-center text-slate-400">
            Link: <span className="font-mono text-slate-600">{portalUrl}</span>
          </p>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="w-full text-center text-xs text-slate-500 hover:text-slate-800 underline pt-1 cursor-pointer"
          >
            Dismiss and continue in browser anyway
          </button>
        </div>
      </div>
    </div>
  );
};
