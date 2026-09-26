import { useSyncExternalStore, useCallback } from 'react';

// In-memory store for navigation badge counts
const badgeStore = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Update the numeric badge count for a given badge identifier.
 * Badge displays nothing when count is 0 or negative.
 */
export function setBadge(id: string, n: number): void {
  const safeCount = Math.max(0, Math.floor(n || 0));
  if (badgeStore.get(id) !== safeCount) {
    badgeStore.set(id, safeCount);
    notify();
  }
}

/**
 * Remove or reset a badge count.
 */
export function clearBadge(id: string): void {
  if (badgeStore.has(id)) {
    badgeStore.delete(id);
    notify();
  }
}

/**
 * Direct non-reactive getter for badge count.
 */
export function getBadge(id?: string): number {
  if (!id) return 0;
  return badgeStore.get(id) ?? 0;
}

/**
 * React hook using useSyncExternalStore to subscribe to live badge count updates.
 */
export function useBadge(id?: string): number {
  const subscribe = useCallback(
    (callback: () => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    []
  );

  const getSnapshot = useCallback(() => {
    if (!id) return 0;
    return badgeStore.get(id) ?? 0;
  }, [id]);

  const getServerSnapshot = useCallback(() => 0, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
