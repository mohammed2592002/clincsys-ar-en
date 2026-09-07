import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Database, 
  AlertTriangle, 
  RefreshCw, 
  Check, 
  Copy, 
  HardDrive, 
  ServerOff, 
  ExternalLink,
  X,
  ShieldAlert,
  CheckCircle2
} from 'lucide-react';

interface DbStatusResponse {
  isPostgres: boolean;
  isPostgresConnected: boolean;
  hasEnv: boolean;
  detectedUrl: string;
  lastError: string | null;
  environment?: {
    has_DATABASE_URL: boolean;
    has_POSTGRES_URL: boolean;
    has_PG_DATABASE_URL: boolean;
    has_PGHOST: boolean;
    has_DB_HOST: boolean;
  };
}

interface DatabaseNoticeModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  autoCheckOnMount?: boolean;
}

export const DatabaseNoticeModal: React.FC<DatabaseNoticeModalProps> = ({
  isOpen: propIsOpen,
  onClose: propOnClose,
  autoCheckOnMount = true
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [dbStatus, setDbStatus] = useState<DbStatusResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [hasDismissedSession, setHasDismissedSession] = useState(false);

  const isOpen = propIsOpen !== undefined ? propIsOpen : internalOpen;

  const handleClose = () => {
    setInternalOpen(false);
    setHasDismissedSession(true);
    if (propOnClose) {
      propOnClose();
    }
  };

  const checkDbStatus = async (isManual = false) => {
    setIsChecking(true);
    try {
      const res = await fetch('/api/db-status', { cache: 'no-store' });
      if (res.ok) {
        const data: DbStatusResponse = await res.json();
        setDbStatus(data);

        // If not connected to Postgres or missing env variables
        if (!data.isPostgresConnected || !data.hasEnv) {
          if (!hasDismissedSession || isManual) {
            setInternalOpen(true);
          }
        } else if (isManual) {
          // If manually rechecked and connected, auto close after 1.5 seconds
          setTimeout(() => {
            handleClose();
          }, 1500);
        }
      }
    } catch (err) {
      console.warn('[DatabaseCheck] Failed to query /api/db-status:', err);
      if (isManual || !hasDismissedSession) {
        setInternalOpen(true);
      }
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (autoCheckOnMount) {
      // Check after a brief delay so the initial UI renders smoothly
      const timer = setTimeout(() => {
        checkDbStatus(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoCheckOnMount]);

  const copyEnvExample = () => {
    const exampleStr = 'DATABASE_URL="postgresql://username:password@hostname:5432/database_name?sslmode=require"';
    navigator.clipboard.writeText(exampleStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[99999] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          dir="rtl"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 340 }}
            className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col my-auto"
          >
            {/* Header with visual indicator */}
            <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-rose-600 p-6 text-white relative">
              <button
                type="button"
                onClick={handleClose}
                className="absolute top-4 left-4 w-8 h-8 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center transition cursor-pointer"
                title="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center shrink-0 shadow-inner">
                  <ServerOff className="w-6 h-6 text-white animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-white/20 text-[10px] font-black uppercase tracking-wider">
                      تنبيه النظام
                    </span>
                  </div>
                  <h2 className="text-xl font-black text-white mt-1">
                    لم يتم الحصول على الداتا بيز
                  </h2>
                  <p className="text-xs text-amber-100 font-medium mt-0.5">
                    لم يتم العثور على إعدادات PostgreSQL في البيئة الافتراضية
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-slate-700 text-xs">
              {/* Notice Banner */}
              <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-extrabold text-amber-900 text-xs">
                    النظام يعمل حالياً في وضع المحاكاة المحلي (Local Mode)
                  </p>
                  <p className="text-amber-800/90 leading-relaxed text-[11px]">
                    لم يتم تمرير متغيرات قاعدة البيانات (<code className="bg-amber-100/80 px-1 py-0.5 rounded font-mono text-[10px]">DATABASE_URL</code> أو <code className="bg-amber-100/80 px-1 py-0.5 rounded font-mono text-[10px]">PGHOST</code>) في إعدادات البيئة الافتراضية الخاصة بالخادم (Environment Variables).
                  </p>
                </div>
              </div>

              {/* Status Diagnostic Card */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 border-b border-slate-200/60 pb-2">
                  <span>حالة الاتصال الحالية:</span>
                  {dbStatus?.isPostgresConnected ? (
                    <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> متصل بـ PostgreSQL
                    </span>
                  ) : (
                    <span className="text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full flex items-center gap-1 font-bold">
                      <ServerOff className="w-3 h-3" /> غير متصل بقاعدة بيانات خارجية
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>متغيرات البيئة (Environment):</span>
                  <span className="font-mono text-[10px] font-semibold text-slate-700">
                    {dbStatus?.hasEnv ? 'متوفرة ولكن فشل الاتصال' : 'غير معرّفة (Not Provided)'}
                  </span>
                </div>

                {dbStatus?.lastError && (
                  <div className="text-[10px] bg-rose-50 text-rose-800 p-2 rounded-xl border border-rose-200 font-mono break-all" dir="ltr">
                    Error: {dbStatus.lastError}
                  </div>
                )}
              </div>

              {/* Instructions on how to configure */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-emerald-600" />
                  <span>طريقة ربط قاعدة بيانات PostgreSQL:</span>
                </h4>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 pr-1">
                  <li>افتح لوحة تحكم الاستضافة (مثل <b>Dokploy</b> أو <b>Vercel</b> أو خادمك).</li>
                  <li>انتقل إلى قسم <b>Environment Variables</b> (المتغيرات البيئية).</li>
                  <li>أضف المتغير التالي برابط قاعدة البيانات الخاص بك:</li>
                </ol>

                {/* Code snippet with copy button */}
                <div className="bg-slate-900 rounded-xl p-3 text-slate-200 font-mono text-[11px] flex items-center justify-between gap-2 shadow-inner" dir="ltr">
                  <span className="truncate text-emerald-400 select-all">
                    DATABASE_URL="postgresql://user:pass@host:5432/db"
                  </span>
                  <button
                    type="button"
                    onClick={copyEnvExample}
                    className="shrink-0 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[10px] font-sans font-bold flex items-center gap-1 transition cursor-pointer border border-slate-700"
                    title="نسخ المتغير"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">تم النسخ</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-slate-300" />
                        <span>نسخ المثال</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => checkDbStatus(true)}
                disabled={isChecking}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                <span>{isChecking ? 'جارِ فحص الاتصال...' : 'فحص الاتصال مجدداً'}</span>
              </button>

              <button
                type="button"
                onClick={handleClose}
                className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>المتابعة بوضع المحاكاة المحلي</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DatabaseNoticeModal;
