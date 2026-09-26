import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'alerts.lastRead';

let memoryLastRead: number = (() => {
  if (typeof window === 'undefined') return 0;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Number(stored) : 0;
  } catch {
    return 0;
  }
})();

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function getLastRead(): number {
  return memoryLastRead;
}

export function setLastRead(timestamp?: number): void {
  const ts = timestamp !== undefined ? timestamp : Date.now();
  memoryLastRead = ts;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, String(ts));
    } catch {
      // Ignore storage write errors in private browsing / memory contexts
    }
  }
  notify();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNotificationsLastRead(): number {
  return useSyncExternalStore(
    subscribe,
    getLastRead,
    () => 0
  );
}
