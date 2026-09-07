import React from "react";
import { useTranslation } from "react-i18next";
import { ViewRole } from "../types";
import { Stethoscope, Monitor, Calculator, Users, Wifi, WifiOff, Zap, Volume2, ShieldCheck } from "lucide-react";

interface HeaderProps {
  currentRole: ViewRole;
  onSelectRole: (role: ViewRole) => void;
  isOffline: boolean;
  onToggleOffline: () => void;
  syncLatencyMs: number;
  waitingCount: number;
  inChairCount: number;
  onOpenTTSBar: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  onSelectRole,
  isOffline,
  onToggleOffline,
  syncLatencyMs,
  waitingCount,
  inChairCount,
  onOpenTTSBar,
}) => {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Logo & System Identity */}
          <div className="flex items-center justify-between md:justify-start gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
                <span className="text-xl font-black tracking-tighter">🦷</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-lg text-slate-900 dark:text-white tracking-tight">
                    coredentsys
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                    v3.5 Ultra Fast
                  </span>
                </div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {isEn ? 'Smart & Fastest Dental Clinic Management' : 'نظام إدارة عيادات الأسنان الأسرع والذكي'}
                </p>
              </div>
            </div>

            {/* Sync Speed Badge & Offline Simulator Button */}
            <div className="flex items-center gap-2 md:hidden">
              <button
                onClick={onToggleOffline}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                  isOffline
                    ? "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700 animate-pulse"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800"
                }`}
              >
                {isOffline ? <WifiOff className="w-3.5 h-3.5 text-amber-600" /> : <Wifi className="w-3.5 h-3.5 text-emerald-600" />}
                <span>{isOffline ? (isEn ? "Offline" : "النت فاصل (نشط محلياً)") : (isEn ? "Online" : "متصل بالشبكة")}</span>
              </button>
            </div>
          </div>

          {/* Navigation View Role Tabs */}
          <nav className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            <button
              onClick={() => onSelectRole("doctor")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap border cursor-pointer ${
                currentRole === "doctor"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-transparent hover:bg-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              <Stethoscope className="w-4 h-4" />
              <span>{isEn ? "Doctor Screen" : "شاشة الطبيب"}</span>
              {inChairCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-white/20 text-white text-[10px] font-black flex items-center justify-center">
                  {inChairCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onSelectRole("reception")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap border cursor-pointer ${
                currentRole === "reception"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-transparent hover:bg-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span>{isEn ? "Reception Desk" : "مكتب الاستقبال"}</span>
              {waitingCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">
                  {waitingCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onSelectRole("accounting")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap border cursor-pointer ${
                currentRole === "accounting"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-transparent hover:bg-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              <Calculator className="w-4 h-4" />
              <span>{isEn ? "Accounting & Closing" : "الحسابات والإغلاق (1-Click)"}</span>
            </button>

            <button
              onClick={() => onSelectRole("patients")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap border cursor-pointer ${
                currentRole === "patients"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-transparent hover:bg-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              <Users className="w-4 h-4" />
              <span>{isEn ? "Patient Files & Chart" : "ملفات المرضى والمخطط"}</span>
            </button>
          </nav>

          {/* Right Status Controls */}
          <div className="hidden md:flex items-center gap-3">
            {/* Realtime Speed Latency Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
              <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500 animate-bounce" />
              <span>{isEn ? `Sync Speed: ${syncLatencyMs}s` : `سرعة المزامنة: ${syncLatencyMs} ثانية`}</span>
            </div>

            {/* Offline Resilience Switch Button */}
            <button
              onClick={onToggleOffline}
              title={isEn ? "Test offline resilience mode" : "تحدي انقطاع النت - اختبر كفاءة النظام أوقات الأزمة"}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                isOffline
                  ? "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700 animate-pulse"
                  : "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800 hover:bg-emerald-100"
              }`}
            >
              {isOffline ? <WifiOff className="w-4 h-4 text-amber-600" /> : <Wifi className="w-4 h-4 text-emerald-600" />}
              <span>{isOffline ? (isEn ? "Offline Mode (Local Active)" : "النت قطع؟ coredentsys مكمل!") : (isEn ? "Online ⚡" : "الشبكة متصلة ⚡")}</span>
            </button>

            {/* Voice Announcement TTS Launcher */}
            <button
              onClick={onOpenTTSBar}
              className="p-2 bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
              title={isEn ? "Clinic Voice Announcer (Gemini TTS)" : "المُنادي الصوتي للعيادة (Gemini TTS)"}
            >
              <Volume2 className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};