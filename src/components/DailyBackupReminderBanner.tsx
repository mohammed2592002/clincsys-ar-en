import React, { useState, useEffect } from 'react';
import { Download, X, HardDrive, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { exportClinicBackup, exportFullSystemBackup, getLocalTodayStr } from '../utils/backupService';
import { safeStorage } from '../utils/storage';

interface DailyBackupReminderBannerProps {
  session: 
    | { type: 'logged_out' }
    | { type: 'admin' }
    | { type: 'clinic'; clinicId: string; clinicName: string }
    | { type: 'clinic_staff'; clinicId: string; clinicName: string; staffName?: string; staffRole?: string; allowedTabs?: string[] };
}

export default function DailyBackupReminderBanner({ session }: DailyBackupReminderBannerProps) {
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
        await exportFullSystemBackup(fmt);
        localStorage.setItem(key, todayStr);
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
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-[92%] max-w-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl shadow-2xl border border-indigo-500/30 p-4 dir-rtl backdrop-blur-md animate-in fade-in slide-in-from-top-5 duration-300">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shrink-0 text-indigo-300 shadow-inner">
            <HardDrive className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-base text-white flex items-center gap-1.5">
                <span>تنبيه النسخة الاحتياطية اليومية</span>
                <span className="bg-indigo-500/30 text-indigo-200 text-xs px-2 py-0.5 rounded-full border border-indigo-400/20 font-mono">
                  12:00 منتصف الليل
                </span>
              </h4>
            </div>
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
              {session.type === 'admin'
                ? 'حان موعد أخذ النسخة الاحتياطية الشاملة لكافة العيادات والسيستم للحفاظ على سلامة البيانات.'
                : 'تذكرة أمان: حان موعد أخذ النسخة الاحتياطية اليومية لبيانات العيادة والمرضى.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {downloadSuccess ? (
            <div className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 px-3 py-2 rounded-xl text-xs font-semibold border border-emerald-500/30">
              <CheckCircle2 className="w-4 h-4" />
              <span>تم التنزيل بنجاح!</span>
            </div>
          ) : (
            <button
              onClick={handleDownloadNow}
              disabled={isDownloading}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-400/30"
            >
              <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce' : ''}`} />
              <span>{isDownloading ? 'جاري التحضير...' : 'تنزيل النسخة الآن'}</span>
            </button>
          )}

          <button
            onClick={handleDismiss}
            title="إغلاق وإخفاء حتى منتصف الليل القادم"
            className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors duration-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
