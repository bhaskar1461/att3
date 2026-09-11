import { DeviceBucket } from '../types/telemetry';

/**
 * Pure function device classifier based on User Agent and hardware capabilities.
 *
 * Classification Tiers:
 * - OLD: Android <= 9, CPU cores <= 4, RAM <= 2GB, or iOS <= 14.
 * - NEW: Android >= 13 with CPU cores >= 8 and RAM >= 6GB, or iOS >= 17 with CPU cores >= 6.
 * - MID: Mainstream mid-tier devices (Android 10-12, or Android 13+ with modest memory/cores, iOS 15-16).
 *
 * Safe fallback: Always returns 'mid' on unknown/empty inputs; never throws an exception.
 */
export function classifyDevice(
  ua: string,
  hardwareConcurrency?: number,
  deviceMemory?: number
): DeviceBucket {
  if (!ua || typeof ua !== 'string') {
    return 'mid';
  }

  const lower = ua.toLowerCase();

  // 1. Android Detection & Version Parsing
  const androidMatch = lower.match(/android\s+([0-9]+(?:\.[0-9]+)*)/);
  if (androidMatch) {
    const majorVersion = parseInt(androidMatch[1].split('.')[0], 10);
    const cores = hardwareConcurrency || 4;
    const ram = deviceMemory || 4;

    // Hard floor for old hardware
    if (majorVersion <= 9 || cores <= 4 || ram <= 2) {
      return 'old';
    }

    // High performance tier
    if (majorVersion >= 13 && cores >= 8 && ram >= 6) {
      return 'new';
    }

    return 'mid';
  }

  // 2. iOS Detection (iPhone, iPad, iPod, iPadOS on Safari)
  const isIos =
    lower.includes('iphone') ||
    lower.includes('ipad') ||
    lower.includes('ipod') ||
    (lower.includes('macintosh') && typeof navigator !== 'undefined' && (navigator as any).maxTouchPoints > 1);

  if (isIos) {
    const iosMatch = lower.match(/os\s+([0-9]+)_/);
    const majorVersion = iosMatch ? parseInt(iosMatch[1], 10) : 16;
    const cores = hardwareConcurrency || 6;

    if (majorVersion <= 14) {
      return 'old';
    }
    if (majorVersion >= 17 && cores >= 6) {
      return 'new';
    }
    return 'mid';
  }

  // 3. Desktop / General Fallback
  if (hardwareConcurrency !== undefined) {
    if (hardwareConcurrency <= 4 && (deviceMemory !== undefined && deviceMemory <= 2)) {
      return 'old';
    }
    if (hardwareConcurrency >= 8 && (deviceMemory === undefined || deviceMemory >= 8)) {
      return 'new';
    }
  }

  return 'mid';
}

/**
 * Helper to get the current runtime device bucket in the browser.
 */
export function getRuntimeDeviceBucket(): DeviceBucket {
  if (typeof navigator === 'undefined') return 'mid';
  const ua = navigator.userAgent || '';
  const cores = navigator.hardwareConcurrency;
  const mem = (navigator as any).deviceMemory;
  return classifyDevice(ua, cores, mem);
}
