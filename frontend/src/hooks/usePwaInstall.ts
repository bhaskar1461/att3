import { useState, useEffect, useCallback } from 'react';
import { detectPlatform, sendPwaTelemetry } from '../services/telemetryService';

export interface PwaInstallState {
  isStandalone: boolean;
  platform: 'ios' | 'android' | 'desktop' | 'unknown';
  browser: string;
  canInstallPrompt: boolean;
  isInstalling: boolean;
  showIosGuide: boolean;
  copied: boolean;
  setShowIosGuide: (show: boolean) => void;
  promptInstall: () => Promise<boolean>;
  copyLink: () => Promise<boolean>;
}

export function usePwaInstall(): PwaInstallState {
  const [isStandalone, setIsStandalone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://')
    );
  });

  const [platformInfo, setPlatformInfo] = useState<{
    platform: 'ios' | 'android' | 'desktop' | 'unknown';
    browser: string;
  }>(() => {
    const { platform, browser } = detectPlatform();
    return { platform, browser };
  });

  const [deferredPrompt, setDeferredPrompt] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      return (window as any).deferredInstallPrompt || null;
    }
    return null;
  });

  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [showIosGuide, setShowIosGuide] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    // 1. Standalone check
    const checkStandalone = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes('android-app://');
      setIsStandalone(standalone);
    };

    checkStandalone();
    setPlatformInfo(detectPlatform());

    // Check if prompt was already captured on window
    if ((window as any).deferredInstallPrompt) {
      setDeferredPrompt((window as any).deferredInstallPrompt);
    }

    // 2. Listen to beforeinstallprompt event (Android / Desktop Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).deferredInstallPrompt = e;
      setDeferredPrompt(e);
      sendPwaTelemetry('PWA_PROMPT_SHOWN');
    };

    // 3. Listen to custom event dispatched by index.html early script
    const handleCustomPwaEvent = () => {
      if ((window as any).deferredInstallPrompt) {
        setDeferredPrompt((window as any).deferredInstallPrompt);
      }
    };

    // 4. Listen to appinstalled event
    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      sendPwaTelemetry('PWA_INSTALLED');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-installable', handleCustomPwaEvent);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-installable', handleCustomPwaEvent);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const copyLink = useCallback(async (): Promise<boolean> => {
    const portalUrl = window.location.origin;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(portalUrl);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = portalUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      return true;
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      return false;
    }
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    // 1. Android / Desktop: native beforeinstallprompt dialog
    const prompt = deferredPrompt || (typeof window !== 'undefined' ? (window as any).deferredInstallPrompt : null);

    if (prompt) {
      setIsInstalling(true);
      try {
        prompt.prompt();
        const choiceResult = await prompt.userChoice;
        if (choiceResult && choiceResult.outcome === 'accepted') {
          setIsStandalone(true);
          setDeferredPrompt(null);
          (window as any).deferredInstallPrompt = null;
          sendPwaTelemetry('PWA_INSTALL_ACCEPTED');
          return true;
        } else {
          sendPwaTelemetry('PWA_INSTALL_DISMISSED');
          return false;
        }
      } catch (err) {
        console.warn('Install prompt error:', err);
        return false;
      } finally {
        setIsInstalling(false);
      }
    }

    // 2. iOS: Apple strictly blocks programmatic shortcut creation.
    // Must guide student to Safari's native toolbar Share button.
    if (platformInfo.platform === 'ios') {
      sendPwaTelemetry('PWA_IOS_GUIDE_SHOWN');
      setShowIosGuide(true);
      return true;
    }

    return false;
  }, [deferredPrompt, platformInfo.platform]);

  return {
    isStandalone,
    platform: platformInfo.platform,
    browser: platformInfo.browser,
    canInstallPrompt: !!deferredPrompt || !!((typeof window !== 'undefined' && (window as any).deferredInstallPrompt)),
    isInstalling,
    showIosGuide,
    copied,
    setShowIosGuide,
    promptInstall,
    copyLink,
  };
}
