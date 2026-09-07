/**
 * safeStorage.ts
 * A robust, safe wrapper around localStorage to prevent "SecurityError: Access is denied"
 * in sandboxed iframes or browsers with restricted third-party storage.
 * It gracefully falls back to an in-memory cache if localStorage is unavailable.
 */

const memoryCache: Record<string, string> = {};

export const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch (e) {
      console.warn(`[SafeStorage] localStorage.getItem failed for key "${key}". Using memory fallback.`, e);
    }
    return memoryCache[key] !== undefined ? memoryCache[key] : null;
  },

  setItem: (key: string, value: string): void => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        return;
      }
    } catch (e) {
      console.warn(`[SafeStorage] localStorage.setItem failed for key "${key}". Using memory fallback.`, e);
    }
    memoryCache[key] = value;
  },

  removeItem: (key: string): void => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
        return;
      }
    } catch (e) {
      console.warn(`[SafeStorage] localStorage.removeItem failed for key "${key}". Using memory fallback.`, e);
    }
    delete memoryCache[key];
  },

  clear: (): void => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
        return;
      }
    } catch (e) {
      console.warn('[SafeStorage] localStorage.clear failed. Clearing memory cache.', e);
    }
    for (const key of Object.keys(memoryCache)) {
      delete memoryCache[key];
    }
  }
};

import { CustomPrescriptionPadConfig, DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG } from '../types';

export function getEffectivePadConfig(
  clinicId?: string,
  clinicPadConfig?: CustomPrescriptionPadConfig
): CustomPrescriptionPadConfig {
  let savedConfig: Partial<CustomPrescriptionPadConfig> = {};
  let savedBg = '';

  if (clinicId) {
    try {
      const raw = safeStorage.getItem(`custom_pad_config_${clinicId}`);
      if (raw) {
        savedConfig = JSON.parse(raw);
      }
      savedBg = safeStorage.getItem(`custom_pad_bg_${clinicId}`) || '';
    } catch (e) {
      console.warn('Failed to parse saved pad config:', e);
    }
  }

  const base = DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG;

  return {
    ...base,
    ...savedConfig,
    ...(clinicPadConfig || {}),
    patientName: { ...base.patientName, ...(savedConfig.patientName || {}), ...(clinicPadConfig?.patientName || {}) },
    patientAge: { ...base.patientAge, ...(savedConfig.patientAge || {}), ...(clinicPadConfig?.patientAge || {}) },
    date: { ...base.date, ...(savedConfig.date || {}), ...(clinicPadConfig?.date || {}) },
    medicationsBox: { ...base.medicationsBox, ...(savedConfig.medicationsBox || {}), ...(clinicPadConfig?.medicationsBox || {}) },
    notesBox: { ...base.notesBox, ...(savedConfig.notesBox || {}), ...(clinicPadConfig?.notesBox || {}) },
    backgroundImage: clinicPadConfig?.backgroundImage || savedConfig.backgroundImage || savedBg || base.backgroundImage || '',
    hideBackgroundOnPrint: clinicPadConfig?.hideBackgroundOnPrint ?? savedConfig.hideBackgroundOnPrint ?? base.hideBackgroundOnPrint ?? true
  };
}

export function saveEffectivePadConfig(
  clinicId: string | undefined,
  config: CustomPrescriptionPadConfig
) {
  if (!clinicId) return;
  try {
    safeStorage.setItem(`custom_pad_config_${clinicId}`, JSON.stringify(config));
    if (config.backgroundImage) {
      safeStorage.setItem(`custom_pad_bg_${clinicId}`, config.backgroundImage);
    } else {
      safeStorage.removeItem(`custom_pad_bg_${clinicId}`);
    }
  } catch (e) {
    console.warn('Failed to save effective pad config:', e);
  }
}

