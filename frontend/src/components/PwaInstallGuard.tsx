import React, { useState } from 'react';
import { Download, Sparkles, X } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

interface PwaInstallGuardProps {
  /** Content to render inside scanner modal */
  children: React.ReactNode;
  /** Optional callback when user dismisses the install prompt */
  onDismiss?: () => void;
}

/**
 * PwaInstallGuard — Non-blocking Browser-First UX Wrapper
 * 
 * Browser is a first-class citizen: attendance scanning works immediately
 * in any standard browser (Android Chrome, iOS Safari, desktop).
 * 
 * Instead of a full-screen blocker, this provides an optional, dismissible
 * one-time bottom hint banner with persistent dismissal in localStorage.
 * Server-authoritative security (device binding, HMAC rotation, time enforcement)
 * guarantees anti-proxy defense without trusting or forcing client installation.
 */
export const PwaInstallGuard: React.FC<PwaInstallGuardProps> = ({ children }) => {
  const {
    isStandalone,
    canInstallPrompt,
    promptInstall,
    isInstalling,
  } = usePwaInstall();

  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pwa_install_hint_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const dismissHint = () => {
    setHintDismissed(true);
    try {
      localStorage.setItem('pwa_install_hint_dismissed', 'true');
    } catch {}
  };

  return (
    <>
      {children}

      {/* Non-intrusive, dismissible installation hint for normal browser sessions */}
      {!isStandalone && !hintDismissed && (
        <div className="fixed bottom-3 left-3 right-3 z-[60] max-w-sm mx-auto bg-[#001e40]/95 backdrop-blur-md text-white px-3.5 py-2 rounded-2xl shadow-xl border border-blue-900/60 flex items-center justify-between gap-2.5 animate-in fade-in slide-in-from-bottom-2 text-xs font-sans">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate text-blue-100 text-[11px] font-medium">
              Tip: Install app for faster 1-tap launch next time
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {canInstallPrompt && (
              <button
                type="button"
                onClick={() => promptInstall()}
                disabled={isInstalling}
                className="px-2 py-0.5 bg-amber-400 hover:bg-amber-300 text-[#001e40] rounded-lg font-black text-[10px] uppercase tracking-wide transition active:scale-95 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Install</span>
              </button>
            )}
            <button
              type="button"
              onClick={dismissHint}
              aria-label="Dismiss tip"
              className="p-1 text-blue-300 hover:text-white transition rounded-md cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
