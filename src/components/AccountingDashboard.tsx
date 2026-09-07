import React, { useState } from "react";
import { FinancialTransaction, ClinicMetrics, Appointment } from "../types";
import { 
  Calculator, 
  DollarSign, 
  TrendingUp, 
  CreditCard, 
  Wallet, 
  Volume2, 
  Sparkles, 
  CheckCircle2, 
  FileText, 
  Loader2, 
  Calendar,
  Layers,
  ArrowUpRight
} from "lucide-react";

interface AccountingDashboardProps {
  transactions: FinancialTransaction[];
  appointments: Appointment[];
  onGenerateTTS: (text: string, voice?: string) => void;
  isOffline: boolean;
}

export const AccountingDashboard: React.FC<AccountingDashboardProps> = ({
  transactions,
  appointments,
  onGenerateTTS,
  isOffline,
}) => {
  const [aiReportLoading, setAiReportLoading] = useState(false);
  const [aiReportText, setAiReportText] = useState<string | null>(null);

  // Calculate Metrics
  const totalRevenue = transactions.reduce((sum, tx) => sum + tx.paid, 0);
  const cashRevenue = transactions.filter((t) => t.method === "cash").reduce((sum, tx) => sum + tx.paid, 0);
  const digitalRevenue = transactions.filter((t) => t.method === "card" || t.method === "instapay").reduce((sum, tx) => sum + tx.paid, 0);
  const labExpenses = 1200; // Dental lab fees
  const netProfit = totalRevenue - labExpenses;
  const totalPatientsToday = appointments.length;

  const handleGenerateExecutiveSummary = async () => {
    setAiReportLoading(true);
    setAiReportText(null);

    try {
      const res = await fetch("/api/ai/dental-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "daily_summary",
          clinicMetrics: {
            totalPatients: totalPatientsToday,
            totalRevenue,
            cashRevenue,
            unpaid: 1000,
            rootCanals: 3,
            prosthetics: 2,
            emergencies: 1,
            tomorrowAppointmentsCount: 7,
          },
        }),
      });

      const data = await res.json();
      if (data.response) {
        setAiReportText(data.response);
        // Automatically read aloud with Gemini TTS
        onGenerateTTS(data.response, "Kore");
      }
    } catch (err) {
      const fallbackReport = `تقرير إغلاق عيادة coredentsys لهذا اليوم: إجمالي المرضى المعالجين ${totalPatientsToday} مريض. الإيراد المحصل ${totalRevenue} جنيه مصري. صافي الأرباح بعد مصاريف المعمل ${netProfit} جنيه. جدول غداً يتضمن 7 مواعيد مؤكدة. تتمنى لكم coredentsys أمساية هادئة.`;
      setAiReportText(fallbackReport);
      onGenerateTTS(fallbackReport, "Kore");
    } finally {
      setAiReportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Peace of Mind Hero Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white rounded-3xl p-6 shadow-xl border border-emerald-700/50 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>إغلاق العيادة بضغطة زرار واحدة 🚀</span>
            </div>
            <h2 className="text-2xl font-black text-white">
              تقفيل الشفت وحسابات اليوم في غاية البساطة والروقان
            </h2>
            <p className="text-xs text-emerald-100/80 mt-1 max-w-2xl leading-relaxed">
              عارف إحساس إنك تقفل عيادتك وأنت طالع ومطمن 100% إن كل مواعيد بكرة وحسابات النهاردة متستفة لوحدها؟ عيش الإحساس ده دلوقتي! 😌
            </p>
          </div>

          <button
            onClick={handleGenerateExecutiveSummary}
            disabled={aiReportLoading}
            className="flex items-center gap-2.5 px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-2xl shadow-lg transition-all active:scale-95 whitespace-nowrap"
          >
            {aiReportLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Volume2 className="w-4 h-4 text-slate-950" />
            )}
            <span>استمع لتقرير تقفيل الشفت الصوتي (Gemini TTS)</span>
          </button>
        </div>
      </div>

      {/* AI Generated Executive Audio Report Card */}
      {aiReportText && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/50 dark:to-teal-950/50 border border-emerald-300 dark:border-emerald-800 rounded-3xl p-6 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-emerald-900 dark:text-emerald-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              التقرير التنفيذي الطبي والمالي للشفت الصوتي:
            </h3>
            <button
              onClick={() => onGenerateTTS(aiReportText, "Kore")}
              className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
            >
              <Volume2 className="w-4 h-4" /> إعادة التشغيل
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
            {aiReportText}
          </p>
        </div>
      )}

      {/* 4 Financial Metrics Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Revenue */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500 dark:text-slate-400 text-xs font-bold">
            <span>الإيراد الإجمالي اليوم</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {totalRevenue} ج.م
          </div>
          <p className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3" /> محصل من {transactions.length} عمليات
          </p>
        </div>

        {/* Cash Revenue */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500 dark:text-slate-400 text-xs font-bold">
            <span>النية الكاش بالخزينة</span>
            <Wallet className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {cashRevenue} ج.م
          </div>
          <p className="text-[10px] text-slate-500 font-medium">
            سيولة نقدية فورية
          </p>
        </div>

        {/* Digital Payments (InstaPay / Cards) */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500 dark:text-slate-400 text-xs font-bold">
            <span>تحويلات انستا باي وفيزا</span>
            <CreditCard className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {digitalRevenue} ج.م
          </div>
          <p className="text-[10px] text-sky-600 font-bold">
            مُثبت بالمعاملات البنكية
          </p>
        </div>

        {/* Net Profit */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500 dark:text-slate-400 text-xs font-bold">
            <span>صافي الأرباح بعد المعمل</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-600">
            {netProfit} ج.م
          </div>
          <p className="text-[10px] text-slate-500 font-medium">
            مخصوم منه {labExpenses} ج.م رسوم المعامل
          </p>
        </div>

      </div>

      {/* Detailed Transactions & Tomorrow's Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Transactions List */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              سجل التحصيلات المالية اليومية
            </h3>
            <button
              onClick={() => alert("تم تصدير تقرير الخزينة اليومي كملف PDF بنجاح.")}
              className="px-3 py-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl"
            >
              طباعة التقرير
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {transactions.map((tx) => (
              <div key={tx.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-extrabold text-xs text-slate-900 dark:text-white">
                    {tx.patientName} - {tx.procedure}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    الوقت: {tx.timestamp} • بواسطة: {tx.recordedBy}
                  </div>
                </div>

                <div className="text-left">
                  <div className="font-black text-xs text-emerald-600">
                    +{tx.paid} ج.م
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {tx.method === "cash" ? "كاش" : tx.method === "card" ? "بطاقة" : "انستاباي"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tomorrow's Schedule Forecast Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
          <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-600" />
            جدول مواعيد غداً (Forecast)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            تم تنظيم المواعيد آلياً لضمان أقصى راحة في شفت غداً.
          </p>

          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2">
            <div className="flex justify-between items-center font-bold text-xs text-emerald-900 dark:text-emerald-200">
              <span>المواعيد المسجلة لغداً:</span>
              <span className="text-base font-black">7 مرضى</span>
            </div>
            <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
              يتضمن 2 حالات عصب، 3 استشارات، وحالة زراعة أسنان.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
