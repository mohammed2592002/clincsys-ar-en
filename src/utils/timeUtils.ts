import { Clinic } from '../types';

export let networkTimeOffset = 0;
export let isNetworkTimeLoaded = false;

// Initialize offset from localStorage on load if available
try {
  if (typeof localStorage !== 'undefined') {
    const savedOffset = localStorage.getItem('networkTimeOffset');
    if (savedOffset) {
      networkTimeOffset = parseInt(savedOffset, 10) || 0;
      isNetworkTimeLoaded = true;
    }
  }
} catch (e) {
  // Silent fallback in secure/sandboxed frames where localStorage is disallowed
}

const saveOffsetLocally = (offset: number) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('networkTimeOffset', offset.toString());
    }
  } catch (e) {}
};

export const fetchNetworkTime = async (): Promise<Date> => {
  try {
    // Try to get server time from standard Date header of same-origin request
    const response = await fetch(window.location.origin, { method: 'HEAD', cache: 'no-store' });
    const serverDateStr = response.headers.get('Date');
    if (serverDateStr) {
      const parsed = new Date(serverDateStr);
      if (!isNaN(parsed.getTime())) {
        isNetworkTimeLoaded = true;
        networkTimeOffset = parsed.getTime() - Date.now();
        saveOffsetLocally(networkTimeOffset);
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Same-origin HEAD fetch failed, trying GET...', e);
  }

  try {
    // Try GET instead of HEAD just in case HEAD is not supported/blocked
    const response = await fetch(window.location.origin, { method: 'GET', cache: 'no-store' });
    const serverDateStr = response.headers.get('Date');
    if (serverDateStr) {
      const parsed = new Date(serverDateStr);
      if (!isNaN(parsed.getTime())) {
        isNetworkTimeLoaded = true;
        networkTimeOffset = parsed.getTime() - Date.now();
        saveOffsetLocally(networkTimeOffset);
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Same-origin GET fetch failed, trying public APIs...', e);
  }

  // Backup public APIs
  const apis = [
    'https://worldtimeapi.org/api/timezone/Etc/UTC',
    'https://timeapi.io/api/time/current/zone?timeZone=UTC'
  ];

  for (const api of apis) {
    try {
      const res = await fetch(api);
      if (res.ok) {
        const data = await res.json();
        const dateTimeStr = data.datetime || data.dateTime || data.currentDateTime;
        if (dateTimeStr) {
          const parsed = new Date(dateTimeStr);
          if (!isNaN(parsed.getTime())) {
            isNetworkTimeLoaded = true;
            networkTimeOffset = parsed.getTime() - Date.now();
            saveOffsetLocally(networkTimeOffset);
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch time from ${api}:`, e);
    }
  }

  return new Date();
};

export const getRealDate = (): Date => {
  return new Date(Date.now() + networkTimeOffset);
};

export const isClinicExpired = (clinic: Clinic): boolean => {
  if (!clinic) return false;
  if (clinic.isActive === false) return true;
  if (!clinic.subscriptionExpiresAt) return false;
  const expiresAt = new Date(clinic.subscriptionExpiresAt);
  return !isNaN(expiresAt.getTime()) && getRealDate() > expiresAt;
};

export const checkSubscriptionBlocked = (clinic: Clinic, dialogs?: any): boolean => {
  if (isClinicExpired(clinic)) {
    const isDeactivated = clinic?.isActive === false;
    const title = isDeactivated ? '🚫 حساب العيادة موقوف' : '🚫 انتهت فترة اشتراك العيادة';
    const message = isDeactivated
      ? 'عذراً، تم إيقاف تنشيط حساب العيادة من قبل إدارة المنصة. النظام حالياً في وضع القراءة فقط لحفظ وتأمين بياناتكم. لا يمكن إضافة أي بيانات جديدة أو تنفيذ إجراءات، ولكن يظل بإمكانكم استعراض الملفات وأخذ نسخة احتياطية بالكامل من تبويب الإعدادات.'
      : 'عذراً، انتهت فترة اشتراك العيادة. النظام حالياً في وضع القراءة فقط لحفظ وتأمين بياناتكم. لا يمكن إضافة أي بيانات جديدة أو تنفيذ إجراءات، ولكن يظل بإمكانكم استعراض الملفات وأخذ نسخة احتياطية بالكامل من تبويب الإعدادات.';

    if (dialogs && typeof dialogs.showAlert === 'function') {
      dialogs.showAlert(title, message);
    } else {
      alert(`${title}\n\n${message}`);
    }
    return true;
  }
  return false;
};

export const getEgyptTodayStr = (): string => {
  try {
    const now = getRealDate();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(now);
  } catch (e) {
    const today = getRealDate();
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  }
};

export const normalizeDateStr = (dStr?: string): string => {
  if (!dStr) return '';
  const clean = dStr.split('T')[0].trim();
  const parts = clean.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      const y = parts[0];
      const m = parts[1].padStart(2, '0');
      const d = parts[2].padStart(2, '0');
      return `${y}-${m}-${d}`;
    } else if (parts[2].length === 4) {
      // DD-MM-YYYY -> YYYY-MM-DD
      const y = parts[2];
      const m = parts[1].padStart(2, '0');
      const d = parts[0].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return clean;
};

export const formatDateTime = (isoString?: string): string => {
  if (!isoString) return 'غير محدد';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'غير صالح';
    return date.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return isoString;
  }
};

export const formatRemainingTime = (diffMs: number): string => {
  if (diffMs <= 0) return 'انتهت الصلاحية';
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} يوم`);
  if (hours > 0 || days > 0) parts.push(`${hours} ساعة`);
  parts.push(`${minutes} دقيقة`);
  parts.push(`${seconds} ثانية`);

  return parts.join(' و ');
};
