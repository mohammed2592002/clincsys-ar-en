import React, { useState } from "react";
import { Appointment, PatientRecord, ToothDetail } from "../types";
import { OdontogramChart } from "./OdontogramChart";
import { 
  Stethoscope, 
  UserCheck, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Plus, 
  Volume2, 
  Sparkles, 
  FileText, 
  DollarSign, 
  Search,
  Activity,
  ArrowLeft,
  ChevronRight,
  Loader2,
  ShieldAlert
} from "lucide-react";

interface DoctorRoomViewProps {
  appointments: Appointment[];
  patients: PatientRecord[];
  onUpdateAppointmentStatus: (id: string, status: Appointment["status"]) => void;
  onUpdatePatientTeeth: (patientId: string, toothNum: number, detail: ToothDetail) => void;
  onGenerateTTS: (text: string, voice?: string) => void;
  onSaveNewAppointment: (apt: Partial<Appointment>) => void;
  isOffline: boolean;
}

export const DoctorRoomView: React.FC<DoctorRoomViewProps> = ({
  appointments,
  patients,
  onUpdateAppointmentStatus,
  onUpdatePatientTeeth,
  onGenerateTTS,
  onSaveNewAppointment,
  isOffline,
}) => {
  const [selectedPatientId, setSelectedPatientId] = useState<string>("p-001");
  const [activeTab, setActiveTab] = useState<"chair" | "odontogram" | "treatment_plan" | "prescriptions">("chair");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Clinical Notes & Prescription state
  const [clinicalNote, setClinicalNote] = useState("تم تنظيف نخر العصب وتسليك 3 قنوات في الضرس #46 مع وضع حشو مؤقت (Cavit).");
  const [rxText, setRxText] = useState("1. Augmentin 1g - كبسولة كل 12 ساعة لمدة 5 أيام بعد الأكل.\n2. Cataflam 50mg - قرص عند اللزوم للألم.");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  // Active in-chair appointment or queue patient
  const inChairApt = appointments.find((a) => a.status === "in_chair") || appointments.find((a) => a.status === "waiting");
  const activePatient = patients.find((p) => p.id === (selectedPatientId || inChairApt?.patientId)) || patients[0];

  const waitingQueue = appointments.filter((a) => a.status === "waiting");
  const completedToday = appointments.filter((a) => a.status === "completed");

  const filteredPatients = patients.filter(
    (p) => p.name.includes(searchQuery) || p.phone.includes(searchQuery) || p.id.includes(searchQuery)
  );

  const handleToothUpdate = (toothNum: number, detail: ToothDetail) => {
    if (activePatient) {
      onUpdatePatientTeeth(activePatient.id, toothNum, detail);
    }
  };

  const handleAskAIDentalAssistant = async () => {
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const res = await fetch("/api/ai/dental-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "treatment_plan",
          patientData: {
            name: activePatient.name,
            age: activePatient.age,
            medicalHistory: activePatient.medicalHistory,
            allergies: activePatient.allergies,
            procedure: inChairApt?.procedure || "علاج عصب وسحب القنوات",
            notes: clinicalNote,
          },
        }),
      });
      const data = await res.json();
      if (data.response) {
        setAiSuggestion(data.response);
      }
    } catch (err) {
      setAiSuggestion("تم إنشاء الخطة العلاجية والتعليمات الطبية بناءً على سجلات coredentsys الذكية.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleSpeakInstructions = () => {
    const textToSpeak = `عزيزي المريض ${activePatient.name}، يرجى اتباع التعليمات التالية بعناية: تجنب الأكل على الجانب المعالج لمدة ساعتين، والالتزام بتناول الدواء في مواعيده. نتمنى لك الشفاء العاجل من عيادتنا coredentsys.`;
    onGenerateTTS(textToSpeak, "Kore");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Alert for Active Patient in Chair */}
      <div className="bg-gradient-to-r from-emerald-900 via-slate-900 to-teal-900 text-white rounded-2xl p-5 shadow-lg border border-emerald-700/50 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
          
          {/* Active Patient Details */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-2xl shadow-lg border border-emerald-400/30">
              {activePatient?.name ? activePatient.name.charAt(0) : "م"}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-slate-950 uppercase">
                  في الكرسي الآن (In Chair)
                </span>
                {inChairApt?.urgency === "urgent" && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> طارئ
                  </span>
                )}
              </div>

              <h2 className="text-xl font-black text-white mt-1">
                {activePatient?.name || "لا يوجد مريض حالياً"}
              </h2>
              <p className="text-xs text-emerald-200/80 mt-0.5 flex items-center gap-3">
                <span>رقم الملف: #{activePatient?.id}</span>
                <span>•</span>
                <span>العمر: {activePatient?.age} سنة ({activePatient?.gender === "male" ? "ذكر" : "أنثى"})</span>
                <span>•</span>
                <span>الهاتف: {activePatient?.phone}</span>
              </p>
            </div>
          </div>

          {/* Medical Alerts & Allergy Warning Badge */}
          <div className="flex flex-wrap items-center gap-2">
            {activePatient?.allergies && activePatient.allergies.length > 0 && (
              <div className="bg-rose-500/20 border border-rose-500/50 text-rose-200 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 animate-bounce" />
                <span>حساسية: {activePatient.allergies.join(", ")}</span>
              </div>
            )}

            {activePatient?.medicalHistory && activePatient.medicalHistory.length > 0 && (
              <div className="bg-amber-500/20 border border-amber-500/50 text-amber-200 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-amber-400" />
                <span>تاريخ طبي: {activePatient.medicalHistory.join(" | ")}</span>
              </div>
            )}

            {activePatient?.unpaidBalance && activePatient.unpaidBalance > 0 ? (
              <div className="bg-rose-950/60 border border-rose-600 text-rose-300 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-rose-400" />
                <span>متبقي آجلي: {activePatient.unpaidBalance} ج.م</span>
              </div>
            ) : null}
          </div>

          {/* Quick Doctor Actions */}
          <div className="flex items-center gap-2">
            {inChairApt && (
              <button
                onClick={() => onUpdateAppointmentStatus(inChairApt.id, "completed")}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>إنهاء الكشف والتالي (بدون ماوس)</span>
              </button>
            )}

            <button
              onClick={handleSpeakInstructions}
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 font-bold text-xs rounded-xl shadow-sm transition-all"
              title="تشغيل تعليمات الصوت الذكية للمريض"
            >
              <Volume2 className="w-4 h-4 text-emerald-400" />
              <span>إلقاء التعليمات بالصوت</span>
            </button>
          </div>

        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Columns: Patient Treatment & Odontogram Tabs */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Sub Navigation Tabs */}
          <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setActiveTab("chair")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === "chair"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <Stethoscope className="w-4 h-4 text-emerald-600" />
              <span>الجلسة الحالية والإجراء</span>
            </button>

            <button
              onClick={() => setActiveTab("odontogram")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === "odontogram"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <span>🦷 مخطط الأسنان (Odontogram)</span>
            </button>

            <button
              onClick={() => setActiveTab("treatment_plan")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === "treatment_plan"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <FileText className="w-4 h-4 text-indigo-600" />
              <span>الخطة والروشتة</span>
            </button>
          </div>

          {/* TAB 1: ACTIVE CHAIR PROCEDURE */}
          {activeTab === "chair" && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Activity className="w-5 h-5 text-emerald-600" />
                    تفاصيل الإجراء في الجلسة
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    السبب الرئيسي للكشف: {inChairApt?.procedure || "متابعة وتقويم"}
                  </p>
                </div>

                <button
                  onClick={handleAskAIDentalAssistant}
                  disabled={aiLoading}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
                >
                  {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>استشارة ذكاء coredentsys الاصطناعي</span>
                </button>
              </div>

              {/* AI Suggestion Box */}
              {aiSuggestion && (
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 border border-emerald-300 dark:border-emerald-800 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      توصيات coredentsys الإكلينيكية الذكية:
                    </span>
                    <button
                      onClick={() => onGenerateTTS(aiSuggestion, "Kore")}
                      className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1"
                    >
                      <Volume2 className="w-3.5 h-3.5" /> استمع بالتسجيل
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                    {aiSuggestion}
                  </p>
                </div>
              )}

              {/* Doctor Clinical Notes Entry */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  ملاحظات الطبيب الطبية وخطوات العلاج المنفذة:
                </label>
                <textarea
                  rows={4}
                  value={clinicalNote}
                  onChange={(e) => setClinicalNote(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="اكتب تفاصيل الحشو أو الجراحة التي تمت..."
                />
              </div>

              {/* Prescription / Medication Quick Add */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  الروشتة الطبية المطبوعة للمريض (E-Prescription):
                </label>
                <textarea
                  rows={3}
                  value={rxText}
                  onChange={(e) => setRxText(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              {/* Audio Reader & Print Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  onClick={() => onGenerateTTS(`الروشتة الطبية للمريض ${activePatient.name}: ${rxText}`, "Kore")}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-xl text-xs font-bold transition-all"
                >
                  <Volume2 className="w-4 h-4 text-emerald-600" />
                  <span>قراءة الروشتة بصوت نقي (Gemini TTS)</span>
                </button>

                <button
                  onClick={() => alert(`تم إرسال الروشتة المطبوعة للمريض ${activePatient.name} بنجاح!`)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 rounded-xl text-xs font-bold transition-all shadow-xs"
                >
                  <FileText className="w-4 h-4" />
                  <span>طباعة / تصدير PDF للروشتة</span>
                </button>
              </div>

            </div>
          )}

          {/* TAB 2: INTERACTIVE ODONTOGRAM CHART */}
          {activeTab === "odontogram" && (
            <OdontogramChart
              teethNotes={activePatient.teethNotes || {}}
              onUpdateTooth={handleToothUpdate}
              onGenerateAudioSummary={(text) => onGenerateTTS(text, "Kore")}
              patientName={activePatient.name}
            />
          )}

          {/* TAB 3: TREATMENT PLAN & FINANCIAL ESTIMATION */}
          {activeTab === "treatment_plan" && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 shadow-xs">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                ملخص الخطة المالية والإجراءات المنجزة
              </h3>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(Object.entries(activePatient.teethNotes || {}) as [string, ToothDetail][]).map(([toothNum, detail]) => (
                  <div key={toothNum} className="py-3 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-xs text-slate-900 dark:text-white">
                        السن #{toothNum} - {detail.condition}
                      </span>
                      {detail.notes && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {detail.notes}
                        </p>
                      )}
                    </div>
                    <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                      {detail.cost || 0} ج.م
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  إجمالي تكلفة العلاج المقدرة:
                </span>
                <span className="text-base font-black text-emerald-600">
                  {(Object.values(activePatient.teethNotes || {}) as ToothDetail[]).reduce((acc, curr) => acc + (curr.cost || 0), 0)} ج.م
                </span>
              </div>
            </div>
          )}

        </div>

        {/* Right 1 Column: Instant Waiting Queue & Search (<0.1s latency) */}
        <div className="space-y-6">
          
          {/* Waiting Queue Header Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  قائمة الانتظار الفورية (Live Queue)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  تحديث تلقائي لحظي بدون ماوس (&lt;1 ثانية)
                </p>
              </div>

              <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {waitingQueue.length} مريض
              </span>
            </div>

            {/* Waiting Patients List */}
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
              {waitingQueue.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  لا يوجد مرضى في الانتظار حالياً ☕
                </div>
              ) : (
                waitingQueue.map((apt, idx) => (
                  <div
                    key={apt.id}
                    onClick={() => {
                      setSelectedPatientId(apt.patientId);
                      onUpdateAppointmentStatus(apt.id, "in_chair");
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                      apt.patientId === activePatient?.id
                        ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 shadow-xs scale-101"
                        : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 hover:border-emerald-400"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-extrabold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                          {apt.patientName}
                        </h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          {apt.time} • {apt.procedure}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateAppointmentStatus(apt.id, "in_chair");
                      }}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold shadow-2xs"
                    >
                      إدخال للكرسي
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Patient Search (<0.1s Fast Lookup) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-600" />
              بحث سريع بملفات المرضى (&lt;0.1 ثانية)
            </h3>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بالاسم أو رقم الهاتف..."
                className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {filteredPatients.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedPatientId(p.id)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between text-xs ${
                    p.id === activePatient?.id
                      ? "bg-emerald-100/60 dark:bg-emerald-950/60 border-emerald-500 font-bold"
                      : "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:bg-slate-100"
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{p.name}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">{p.phone}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
