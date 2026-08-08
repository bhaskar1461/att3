/**
 * Device Credential Service — Web Crypto & Persistent Device ID
 * Manages persistent client device public ID and secret for 30-minute account binding.
 */

interface DeviceCredentials {
  device_public_id: string;
  device_secret: string;
}

const DEVICE_ID_KEY = 'snist_device_public_id';
const DEVICE_SECRET_KEY = 'snist_device_secret';

export function getOrCreateDeviceCredentials(): DeviceCredentials {
  let publicId = localStorage.getItem(DEVICE_ID_KEY);
  let secret = localStorage.getItem(DEVICE_SECRET_KEY);

  if (!publicId || !secret) {
    // Generate secure random device credentials using Web Crypto API
    const array = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(array);
      publicId = 'DEV-' + Array.from(array, b => b.toString(16).padStart(2, '0')).join('').substring(0, 16).toUpperCase();
      
      const secretArray = new Uint8Array(32);
      window.crypto.getRandomValues(secretArray);
      secret = Array.from(secretArray, b => b.toString(16).padStart(2, '0')).join('');
    } else {
      // Fallback timestamp + math random string
      publicId = 'DEV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 8).toUpperCase();
      secret = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    }

    localStorage.setItem(DEVICE_ID_KEY, publicId);
    localStorage.setItem(DEVICE_SECRET_KEY, secret);
  }

  return {
    device_public_id: publicId,
    device_secret: secret
  };
}

export function getDeviceHeaders(): Record<string, string> {
  const creds = getOrCreateDeviceCredentials();
  return {
    'X-Device-Public-Id': creds.device_public_id,
    'X-Device-Secret': creds.device_secret
  };
}
