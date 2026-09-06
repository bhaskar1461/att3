import React from 'react';
import { Download, Smartphone, Share2, PlusSquare, Check, Copy, ShieldCheck, X, Sparkles, ExternalLink, ArrowDown } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

interface PwaInstallGuardProps {
  /** Content to render when running inside installed PWA standalone mode */
  children: React.ReactNode;
  /** Optional callback when user dismisses the install prompt (e.g. to close the scanner modal) */
  onDismiss?: () => void;
}

/**
 * PwaInstallGuard — Layer 1 Anti-Proxy Defense with 1-Tap Action Buttons
 * 
 * UX guard: Attendance scanning requires running inside the installed PWA standalone mode.
 * In regular browsers, provides direct 1-tap action buttons:
 * - Android: [Install App Now] invokes native beforeinstallprompt dialog directly.
 * - iOS Safari: [Create Home Screen Shortcut] invokes navigator.share to pop up native iOS sheet.
 * - iOS Chrome/Brave: [Copy Link & Open Safari] since iOS only permits PWA install via Safari.
 */
export const PwaInstallGuard: React.FC<PwaInstallGuardProps> = ({ children, onDismiss }) => {
  const {
    isStandalone,
    platform,
    browser,
    canInstallPrompt,
    isInstalling,
    showIosGuide,
    copied,
    setShowIosGuide,
    promptInstall,
    copyLink,
  } = usePwaInstall();

  // If running in standalone mode, render scanner immediately
  if (isStandalone) {
    return <>{children}</>;
  }

  const isIosNonSafari = platform === 'ios' && browser !== 'safari';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white text-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[92vh] font-sans border border-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#001e40] text-white flex items-center justify-center shadow-sm">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-[#001e40]">Security Verification</h3>
              <p className="text-[11px] text-slate-500 font-medium">SNIST Anti-Proxy Attendance Engine</p>
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="Close"
              className="p-1.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 flex-1 flex flex-col items-center text-center space-y-4 overflow-y-auto">
          
          {/* Official SNIST Badge Icon Frame */}
          <div className="relative group">
            <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-lg border-2 border-[#001e40]/15 bg-[#08142c] flex items-center justify-center p-1.5">
              <img
                src="/apple-touch-icon.png"
                alt="SNIST Official App Icon"
                className="w-full h-full object-contain rounded-xl"
              />
            </div>
            <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white rounded-full p-1 shadow-md border-2 border-white">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Heading */}
          <div>
            <h2 className="text-xl font-black text-[#001e40] tracking-tight">
              Install SNIST ERP App
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-xs mx-auto">
              Institutional security requires attendance to be marked inside the installed app shortcut.
            </p>
          </div>

          {/* PLATFORM ACTIONS */}

          {/* 1. ANDROID ACTION & GUIDANCE */}
          {platform === 'android' && (
            <div className="w-full space-y-3 pt-1">
              <button
                onClick={() => promptInstall()}
                disabled={isInstalling}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-5 bg-gradient-to-r from-[#001e40] to-[#0a3568] hover:from-[#002855] hover:to-[#0e4384] text-white rounded-2xl font-bold text-sm shadow-lg shadow-[#001e40]/25 hover:shadow-xl transition-all active:scale-[0.98] disabled:opacity-50"
              >
                <Download className="w-5 h-5 text-amber-400 shrink-0" />
                <span>{isInstalling ? 'Opening Installer...' : 'Install App Now (1 Tap)'}</span>
              </button>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3.5 text-left text-xs text-slate-600 space-y-2">
                <p className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                  If the 1-tap prompt doesn't appear:
                </p>
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#001e40] text-white flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                  <span>Tap Chrome's <strong>⋮ menu</strong> (top right)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#001e40] text-white flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                  <span>Select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></span>
                </div>
              </div>
            </div>
          )}

          {/* 2. IOS ACTION & GUIDANCE */}
          {platform === 'ios' && (
            <div className="w-full space-y-3 pt-1">
              {!isIosNonSafari ? (
                <div className="space-y-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-left text-xs text-blue-900 leading-relaxed font-medium">
                    Apple requires adding to your home screen using <strong>Safari's bottom toolbar</strong>:
                  </div>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3.5 text-left text-xs text-slate-700 space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-[#001e40] text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
                      <div>
                        <p className="font-bold text-slate-900 flex items-center gap-1.5">
                          Tap Safari's Share button <Share2 className="w-3.5 h-3.5 text-[#007AFF] inline" />
                        </p>
                        <p className="text-slate-500 text-[11px]">Located at the bottom center of your screen</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-[#001e40] text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
                      <div>
                        <p className="font-bold text-slate-900">
                          Scroll down &amp; tap <strong>"Add to Home Screen"</strong> (➕)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-[#001e40] text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span>
                      <div>
                        <p className="font-bold text-slate-900">
                          Tap <strong>"Add"</strong> at top-right
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-1 text-center">
                    <div className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-100 text-amber-900 rounded-full text-xs font-black animate-bounce shadow-sm">
                      <ArrowDown className="w-4 h-4 text-amber-700" />
                      <span>Look down at the Safari toolbar below</span>
                      <ArrowDown className="w-4 h-4 text-amber-700" />
                    </div>
                  </div>
                </div>
              ) : (
                /* iOS Chrome / Brave Warning & Copy Button */
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3 text-left text-xs text-amber-900">
                    <strong>Notice:</strong> Apple requires using <strong>Safari</strong> on iPhone to install home screen apps.
                  </div>
                  <button
                    onClick={() => copyLink()}
                    className={`w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-bold text-sm shadow-md transition-all active:scale-[0.98] ${
                      copied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#001e40] hover:bg-[#003366] text-white'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Link Copied! Now Open Safari</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy Link &amp; Open Safari</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 3. DESKTOP / OTHER ACTION & GUIDANCE */}
          {platform === 'desktop' && (
            <div className="w-full space-y-3 pt-1">
              <button
                onClick={() => promptInstall()}
                disabled={isInstalling}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-5 bg-[#001e40] hover:bg-[#002e60] text-white rounded-2xl font-bold text-sm shadow-lg transition-all active:scale-[0.98]"
              >
                <Download className="w-5 h-5 text-amber-400 shrink-0" />
                <span>Install SNIST App on Computer</span>
              </button>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-left text-xs text-slate-600 space-y-1.5">
                <p className="font-bold text-slate-800 text-[11px]">Or install via browser address bar:</p>
                <p className="text-[11px] text-slate-600">
                  Click the <strong>install icon (💻 / ⊕)</strong> in Chrome/Edge address bar on the right.
                </p>
              </div>
            </div>
          )}

          {/* Security Note */}
          <div className="pt-2">
            <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs mx-auto">
              Once installed, launch the <strong>SNIST Attendance</strong> app from your phone's home screen to scan classroom QR codes instantly.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
};
