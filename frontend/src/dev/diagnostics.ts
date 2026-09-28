/**
 * SNIST ERP - Phase 0 Dev-Only Diagnostic Instrumentation
 * 
 * Provides empirical measurement of:
 * - Boot counter (distinguishes reload vs render loop)
 * - Render counters per instance
 * - getUserMedia spy & active stream tracking
 * - Navigation logger with stack tracing
 * - Timer & RAF registry with creation stacks
 * - Effect tracer for dependency churn
 * - Live HUD dashboard overlay
 */

import React from 'react';

export interface NavLogEntry {
  url: string;
  method: 'pushState' | 'replaceState' | 'location.assign' | 'location.replace';
  timestamp: number;
  stack: string;
}

export interface DiagState {
  bootCount: number;
  renders: Record<string, { total: number; instances: Record<string, number> }>;
  activeStreams: number;
  activeRaf: number;
  activeIntervals: number;
  activeTimeouts: number;
  navCount: number;
  navHistory: NavLogEntry[];
  timerStacks: Map<number, { type: string; stack: string }>;
}

const isBrowser = typeof window !== 'undefined';

// Enable if in dev mode or explicitly enabled via localStorage / query param / window flag
export const isDiagEnabled = (): boolean => {
  if (!isBrowser) return false;
  if ((window as any).__ENABLE_DIAGNOSTICS__ === true) return true;
  if (window.location.search.includes('diag=true')) return true;
  if (localStorage.getItem('snist_diag_enabled') === 'true') return true;
  return import.meta.env?.DEV ?? false;
};

// Global state container
export const diagState: DiagState = {
  bootCount: 0,
  renders: {},
  activeStreams: 0,
  activeRaf: 0,
  activeIntervals: 0,
  activeTimeouts: 0,
  navCount: 0,
  navHistory: [],
  timerStacks: new Map(),
};

if (isBrowser) {
  (window as any).__DIAG_STATE__ = diagState;
}

// Listeners for HUD overlay updates
type HudListener = () => void;
const hudListeners = new Set<HudListener>();
function notifyHud() {
  hudListeners.forEach(fn => fn());
}

/**
 * 1. BOOT COUNTER: Module-top-level in main.tsx
 */
export function recordBoot(): number {
  if (!isBrowser) return 0;
  console.log('[BOOT]', Date.now());
  const prev = parseInt(localStorage.getItem('bootCount') || '0', 10);
  const next = isNaN(prev) ? 1 : prev + 1;
  localStorage.setItem('bootCount', String(next));
  diagState.bootCount = next;
  notifyHud();
  return next;
}

/**
 * 2. RENDER COUNTER HOOK
 */
const instanceCounters: Record<string, number> = {};

export function useRenderCounter(componentName: string): string {
  if (!isDiagEnabled()) return '0';

  const instanceIdRef = React.useRef<string | null>(null);
  if (!instanceIdRef.current) {
    instanceCounters[componentName] = (instanceCounters[componentName] || 0) + 1;
    instanceIdRef.current = String(instanceCounters[componentName]);
  }

  const id = instanceIdRef.current;
  if (!diagState.renders[componentName]) {
    diagState.renders[componentName] = { total: 0, instances: {} };
  }
  diagState.renders[componentName].total += 1;
  diagState.renders[componentName].instances[id] = (diagState.renders[componentName].instances[id] || 0) + 1;

  const count = diagState.renders[componentName].instances[id];
  console.log(`[RENDER] ${componentName}#${id} (render #${count})`);
  notifyHud();

  return id;
}

/**
 * 3. EFFECT TRACER HOOK
 */
export function useEffectTracer(
  componentName: string,
  instanceId: string,
  effectName: string,
  deps: any[]
): void {
  const prevDepsRef = React.useRef<any[] | null>(null);

  React.useEffect(() => {
    if (!isDiagEnabled()) return;
    const prev = prevDepsRef.current;
    if (prev === null) {
      console.log(`[EFFECT:MOUNT] ${componentName}#${instanceId} -> ${effectName}`, deps);
    } else {
      const changed: Record<number, { from: any; to: any }> = {};
      deps.forEach((d, i) => {
        if (!Object.is(d, prev[i])) {
          changed[i] = { from: prev[i], to: d };
        }
      });
      console.log(`[EFFECT:UPDATE] ${componentName}#${instanceId} -> ${effectName}`, changed);
    }
    prevDepsRef.current = deps;
  }, deps);
}

/**
 * 4. SYSTEM-WIDE SPY INITIALIZATION
 */
let isInitialized = false;

export function initDiagnostics(): void {
  if (!isBrowser || isInitialized) return;
  if (!isDiagEnabled()) return;
  isInitialized = true;

  recordBoot();

  // (A) getUserMedia SPY
  if (navigator?.mediaDevices?.getUserMedia) {
    const originalGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stack = new Error().stack || '';
      console.log('[GUM:CALL] getUserMedia called with constraints:', constraints, '\nStack:\n' + stack);

      try {
        const stream = await originalGUM(constraints);
        diagState.activeStreams += 1;
        notifyHud();

        // Listen for all tracks stopped
        const checkActive = () => {
          const hasActiveTrack = stream.getTracks().some(t => t.readyState === 'live');
          if (!hasActiveTrack) {
            diagState.activeStreams = Math.max(0, diagState.activeStreams - 1);
            console.log('[GUM:STREAM_STOPPED] Stream tracks ended. Active streams:', diagState.activeStreams);
            notifyHud();
          }
        };

        stream.getTracks().forEach(track => {
          track.addEventListener('ended', checkActive, { once: true });
        });

        // Wrap stream.stop if invoked on tracks
        const origStopTrack = stream.getTracks()[0]?.stop;
        if (origStopTrack) {
          stream.getTracks().forEach(track => {
            const orig = track.stop.bind(track);
            track.stop = () => {
              orig();
              checkActive();
            };
          });
        }

        return stream;
      } catch (err) {
        console.error('[GUM:ERROR] getUserMedia failed:', err, '\nStack:\n' + stack);
        throw err;
      }
    };
  }

  // (B) NAVIGATION LOGGER
  const logNav = (method: NavLogEntry['method'], url: string) => {
    const stack = new Error().stack || '';
    diagState.navCount += 1;
    const entry: NavLogEntry = {
      url: String(url),
      method,
      timestamp: Date.now(),
      stack,
    };
    diagState.navHistory.push(entry);
    console.log(`[NAV:${method.toUpperCase()}] target: "${url}" (nav #${diagState.navCount})\nStack:\n${stack}`);
    notifyHud();
  };

  const origPush = window.history.pushState.bind(window.history);
  window.history.pushState = function (state: any, unused: string, url?: string | URL | null) {
    if (url) logNav('pushState', String(url));
    return origPush(state, unused, url);
  };

  const origReplace = window.history.replaceState.bind(window.history);
  window.history.replaceState = function (state: any, unused: string, url?: string | URL | null) {
    if (url) logNav('replaceState', String(url));
    return origReplace(state, unused, url);
  };

  // (C) TIMER REGISTRY
  const origSetInterval = window.setInterval.bind(window);
  const origClearInterval = window.clearInterval.bind(window);
  (window as any).setInterval = function (handler: TimerHandler, timeout?: number, ...args: any[]): number {
    const id = (origSetInterval as any)(handler, timeout, ...args);
    diagState.activeIntervals += 1;
    diagState.timerStacks.set(id, { type: 'interval', stack: new Error().stack || '' });
    notifyHud();
    return id;
  };
  window.clearInterval = function (id?: number) {
    if (id !== undefined && diagState.timerStacks.has(id)) {
      diagState.activeIntervals = Math.max(0, diagState.activeIntervals - 1);
      diagState.timerStacks.delete(id);
      notifyHud();
    }
    return origClearInterval(id);
  };

  const origSetTimeout = window.setTimeout.bind(window);
  const origClearTimeout = window.clearTimeout.bind(window);
  (window as any).setTimeout = function (handler: TimerHandler, timeout?: number, ...args: any[]): number {
    const id = (origSetTimeout as any)((...innerArgs: any[]) => {
      diagState.activeTimeouts = Math.max(0, diagState.activeTimeouts - 1);
      diagState.timerStacks.delete(id);
      notifyHud();
      if (typeof handler === 'function') {
        handler(...innerArgs);
      } else {
        new Function(handler)();
      }
    }, timeout, ...args);
    diagState.activeTimeouts += 1;
    diagState.timerStacks.set(id, { type: 'timeout', stack: new Error().stack || '' });
    notifyHud();
    return id;
  };
  window.clearTimeout = function (id?: number) {
    if (id !== undefined && diagState.timerStacks.has(id)) {
      diagState.activeTimeouts = Math.max(0, diagState.activeTimeouts - 1);
      diagState.timerStacks.delete(id);
      notifyHud();
    }
    return origClearTimeout(id);
  };

  const origRAF = window.requestAnimationFrame.bind(window);
  const origCancelRAF = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = function (callback: FrameRequestCallback): number {
    const id = origRAF((time) => {
      diagState.activeRaf = Math.max(0, diagState.activeRaf - 1);
      diagState.timerStacks.delete(id);
      notifyHud();
      callback(time);
    });
    diagState.activeRaf += 1;
    diagState.timerStacks.set(id, { type: 'raf', stack: new Error().stack || '' });
    notifyHud();
    return id;
  };
  window.cancelAnimationFrame = function (id: number) {
    if (diagState.timerStacks.has(id)) {
      diagState.activeRaf = Math.max(0, diagState.activeRaf - 1);
      diagState.timerStacks.delete(id);
      notifyHud();
    }
    return origCancelRAF(id);
  };

  mountDiagnosticsHud();
}

/**
 * 5. RESOURCE DASHBOARD (HUD OVERLAY)
 */
function mountDiagnosticsHud() {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('snist-diag-hud');
  if (existing) return;

  const hud = document.createElement('div');
  hud.id = 'snist-diag-hud';
  hud.style.cssText = `
    position: fixed;
    bottom: 8px;
    left: 8px;
    z-index: 999999;
    background: rgba(15, 23, 42, 0.92);
    color: #38bdf8;
    border: 1px solid #0284c7;
    border-radius: 8px;
    padding: 6px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    line-height: 1.4;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    backdrop-filter: blur(4px);
    max-width: 95vw;
    word-break: break-all;
  `;

  function updateHud() {
    const r = diagState.renders;
    const renderStr = Object.keys(r)
      .map(k => `${k}=${r[k].total}`)
      .join(' ') || 'none';

    hud.innerText = `[DIAG] renders: ${renderStr} | streams:${diagState.activeStreams} raf:${diagState.activeRaf} intervals:${diagState.activeIntervals} timeouts:${diagState.activeTimeouts} | boots:${diagState.bootCount} | navs:${diagState.navCount}`;
  }

  hudListeners.add(updateHud);
  updateHud();

  if (document.body) {
    document.body.appendChild(hud);
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(hud);
    });
  }
}
