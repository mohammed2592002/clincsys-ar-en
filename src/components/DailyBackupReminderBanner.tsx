import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X, HardDrive, CalendarClock, CheckCircle2 } from 'lucide-react';
import { exportClinicBackup, downloadSystemBackupGz, getLocalTodayStr } from '../utils/backupService';
import { safeStorage } from '../utils/storage';

interface DailyBackupReminderBannerProps {
  session: 
    | { type: 'logged_out' }
    | { type: 'admin' }
    | { type: 'clinic'; clinicId: string; clinicName: string }
    | { type: 'clinic_staff'; clinicId: string; clinicName: string; staffName?: string; staffRole?: string; allowedTabs?: string[] };
}

export default function DailyBackupReminderBanner({ session }: DailyBackupReminderBannerProps) {
  const { i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const [showBanner, setShowBanner] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const getStorageKey = () => {
    if (session.type === 'admin') {
      return 'auto_backup_admin_last_date';
    }
    if (session.type === 'clinic' || session.type === 'clinic_staff') {
      return `auto_backup_last_date_${session.clinicId}`;
    }
    return null;
  };

  const getTargetFormat = (): 'json' | 'db' | 'sql' => {
    if (session.type === 'admin') {
      return (localStorage.getItem('auto_backup_admin_format') as 'json' | 'db' | 'sql') || 'json';
    }
    if (session.type === 'clinic' || session.type === 'clinic_staff') {
      return (safeStorage.getItem(`auto_backup_format_${session.clinicId}`) as 'json' | 'db' | 'sql') || 'json';
    }
    return 'json';
  };

  const checkBackupDue = () => {
    if (session.type === 'logged_out') {
      setShowBanner(false);
      return;
    }

    const key = getStorageKey();
    if (!key) return;

    const todayStr = getLocalTodayStr();
    const lastDate = safeStorage.getItem(key) || localStorage.getItem(key);

    // If today's date hasn't been saved yet, backup is due for today!
    if (lastDate !== todayStr) {
      setShowBanner(true);
    } else {
      setShowBanner(false);
    }
  };

  useEffect(() => {
    checkBackupDue();

    // Re-check every 30 seconds (to catch midnight transition 00:00)
    const interval = setInterval(() => {
      checkBackupDue();
    }, 30000);

    const handleOnline = () => {
      checkBackupDue();
    };

    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, [session]);

  const handleDownloadNow = async () => {
    const key = getStorageKey();
    if (!key) return;

    setIsDownloading(true);
    const todayStr = getLocalTodayStr();
    const fmt = getTargetFormat();

    try {
      if (session.type === 'admin') {
        // Unified single format: the daily admin reminder downloads the .json.gz system backup.
        const { size } = await downloadSystemBackupGz();
        localStorage.setItem(key, todayStr);
        localStorage.setItem('auto_backup_admin_last_full', JSON.stringify({ date: new Date().toISOString(), size }));
      } else if (session.type === 'clinic' || session.type === 'clinic_staff') {
        await exportClinicBackup(session.clinicId, { name: session.clinicName }, fmt, true);
        safeStorage.setItem(key, todayStr);
      }

      setDownloadSuccess(true);
      setTimeout(() => {
        setShowBanner(false);
        setDownloadSuccess(false);
      }, 2500);
    } catch (err) {
      console.error('Backup download error:', err);
      // Even if auto trigger had an issue, user can click again
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDismiss = () => {
    const key = getStorageKey();
    if (!key) return;

    const todayStr = getLocalTodayStr();
    if (session.type === 'admin') {
      localStorage.setItem(key, todayStr);
    } else {
      safeStorage.setItem(key, todayStr);
    }

    setShowBanner(false);
  };

  if (!showBanner || session.type === 'logged_out') return null;

  return (
    <div dir={isEn ? 'ltr' : 'rtl'} className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-[94%] max-w-2xl animate-in fade-in slide-in-from-top-5 duration-300">
      <div className="relative bg-[#272E40] text-white rounded-2xl shadow-2xl border border-slate-700/60 border-t-2 border-t-emerald-400 p-4 sm:p-5 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3.5 flex-1 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0 shadow-inner">
              <HardDrive className="w-6 h-6 text-emerald-400 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-black text-base text-white">
                  {isEn ? 'Daily Backup Reminder' : 'تنبيه النسخة الاحتياطية اليومية'}
                </h4>
                <span className="inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-300 text-[11px] px-2.5 py-0.5 rounded-full border border-emerald-400/30 font-bold">
                  <CalendarClock className="w-3 h-3" />
                  {isEn ? 'Daily 12:00 midnight' : 'يوميًا 12:00 منتصف الليل'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {session.type === 'admin'
                  ? (isEn ? 'Time to take the full backup of all clinics and the system to keep the data safe.' : 'حان موعد أخذ النسخة الاحتياطية الشاملة لكافة العيادات والسيستم للحفاظ على سلامة البيانات.')
                  : (isEn ? 'Security reminder: it is time to take the daily backup of your clinic and patients data.' : 'تذكير أمان: حان موعد أخذ النسخة الاحتياطية اليومية لبيانات العيادة والمرضى.')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {downloadSuccess ? (
              <div className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-emerald-500/20 text-emerald-300 px-4 py-3 rounded-xl text-xs font-bold border border-emerald-500/30">
                <CheckCircle2 className="w-4 h-4" />
                <span>{session.type === 'admin' ? (isEn ? 'Backup sent. Check browser Downloads.' : 'أُرسلت النسخة. راجع تنزيلات المتصفح.') : (isEn ? 'Downloaded successfully!' : 'تم التنزيل بنجاح!')}</span>
              </div>
            ) : (
              <button
                onClick={handleDownloadNow}
                disabled={isDownloading}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gradient-to-l from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 active:scale-95 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-lg shadow-emerald-900/40 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce' : ''}`} />
                <span>{isDownloading ? (isEn ? 'Preparing...' : 'جاري التحضير...') : (isEn ? 'Download Backup Now' : 'تنزيل النسخة الآن')}</span>
              </button>
            )}

            <button
              onClick={handleDismiss}
              title={isEn ? 'Dismiss until next midnight' : 'إغلاق وإخفاء حتى منتصف الليل القادم'}
              className="absolute top-3 left-3 sm:static w-9 h-9 flex items-center justify-center shrink-0 bg-rose-500/15 border border-rose-500/40 text-rose-400 hover:bg-rose-500/25 hover:text-rose-300 rounded-xl transition-colors duration-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
