import React, { useState } from "react";
import { Appointment, PatientRecord, FinancialTransaction } from "../types";
import { formatEgyptianPhoneInput, isValidEgyptianPhone, getEgyptianPhoneError } from "../utils/phoneUtils";
import { isAppointmentTimeConflict } from "../utils/appointmentUtils";
import { 
  Monitor, 
  Plus, 
  Volume2, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  Phone, 
  User, 
  Search, 
  Send,
  Zap,
  Loader2,
  Calendar,
  AlertCircle
} from "lucide-react";

interface ReceptionDeskViewProps {
  appointments: Appointment[];
  patients: PatientRecord[];
  onAddNewAppointment: (apt: Partial<Appointment>) => void;
  onAddNewPatient: (pat: Partial<PatientRecord>) => void;
  onRecordPayment: (tx: Partial<FinancialTransaction>) => void;
  onGenerateTTS: (text: string, voice?: string) => void;
  isOffline: boolean;
}

export const ReceptionDeskView: React.FC<ReceptionDeskViewProps> = ({
  appointments,
  patients,
  onAddNewAppointment,
  onAddNewPatient,
  onRecordPayment,
  onGenerateTTS,
  isOffline,
}) => {
  // Booking Form State
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [procedure, setProcedure] = useState("كشف وقياس أسنان");
  const [time, setTime] = useState("11:30 AM");
  const [urgency, setUrgency] = useState<"normal" | "urgent">("normal");
  const [doctorName, setDoctorName] = useState("د. طارق الحسين");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Payment Quick Modal
  const [selectedAptForPayment, setSelectedAptForPayment] = useState<Appointment | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(500);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "instapay">("cash");

  const handleCreateBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName.trim()) return;

    const cleanPhone = patientPhone ? formatEgyptianPhoneInput(patientPhone) : '01000000000';
    if (patientPhone.trim()) {
      const phoneErr = getEgyptianPhoneError(cleanPhone, false, 'رقم الهاتف');
      if (phoneErr) {
        alert(phoneErr);
        return;
      }
    }

    // Check for double booking conflict
    const activeApps = appointments.filter(a => a.status !== 'cancelled' && a.status !== 'Cancelled');
    const hasConflict = activeApps.some(a => isAppointmentTimeConflict(a.time, time));

    if (hasConflict) {
      alert('عفواً، يوجد موعد محجوز مسبقاً في نفس الساعة/الوقت!');
      return;
    }

    setIsSubmitting(true);

    const newApt: Partial<Appointment> = {
      patientName,
      patientPhone: cleanPhone,
      procedure,
      time,
      urgency,
      doctorName,
      status: "waiting",
      notes,
    };

    onAddNewAppointment(newApt);

    setTimeout(() => {
      setIsSubmitting(false);
      setShowSuccessToast(true);
      setPatientName("");
      setPatientPhone("");
      setNotes("");
      setTimeout(() => setShowSuccessToast(false), 3000);
    }, 200);
  };

  const handleCallPatientVoice = (apt: Appointment) => {
    const announcementText = `تنبيه: نداء للمريض ${apt.patientName}، يتفضل بالدخول الآن لعيادة ${apt.doctorName}. نتمنى لك السلامة.`;
    onGenerateTTS(announcementText, "Kore");
  };

  const handleConfirmPayment = () => {
    if (!selectedAptForPayment) return;
    onRecordPayment({
      patientId: selectedAptForPayment.patientId,
      patientName: selectedAptForPayment.patientName,
      procedure: selectedAptForPayment.procedure,
      amount: selectedAptForPayment.cost || paymentAmount,
      paid: paymentAmount,
      method: paymentMethod,
    });
    setSelectedAptForPayment(null);
  };

  return (
    <div className="space-y-6">
      
      {/* Toast Notification for <1s Instant Doctor Sync */}
      {showSuccessToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white border border-emerald-500 rounded-2xl p-4 shadow-2xl flex items-center gap-3 animate-bounce">
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-slate-950 font-bold">
            ⚡
          </div>
          <div>
            <div className="font-bold text-xs text-emerald-400">
              تم التسجيل والمزامنة بضغطة زرار واحدة!
            </div>
            <div className="text-[11px] text-slate-300">
              ظهر الموعد فوراً على شاشة الدكتور في أقل من ثانية (&lt;1s sync).
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Left Quick Booking Form, Right Live Today's Schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (1 Col): Fast Booking & Patient Reg Form */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-5">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-600" />
              حجز موعد جديد سريع (&lt;ثانية)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              ادخل بيانات المريض لتظهر فوراً لدى الطبيب دون حاجة للاتصال.
            </p>
          </div>

          <form onSubmit={handleCreateBooking} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                اسم المريض الثلاثي: *
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="مثال: محمد السيد مصطفى"
                  className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                رقم الهاتف (واتساب):
                <span className="text-[10px] text-slate-400 font-normal mr-1">(11 رقم يبدأ بـ 01)</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                <input
                  type="tel"
                  maxLength={11}
                  inputMode="numeric"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(formatEgyptianPhoneInput(e.target.value))}
                  placeholder="01012345678"
                  className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none font-mono font-bold"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  الإجراء المطلوب:
                </label>
                <select
                  value={procedure}
                  onChange={(e) => setProcedure(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="كشف وقياس أسنان">كشف واستشارة</option>
                  <option value="حشو عصب وسحب عصب (Root Canal)">علاج عصب (Root Canal)</option>
                  <option value="تنظيف جير وتلميع أسنان (Scaling)">تنظيف جير وتلميع</option>
                  <option value="تركيب زيركون كراون (Zirconia Crown)">تركيب تاج / كراون</option>
                  <option value="خلع جراحي لضرس العقل">خلع جراحي لضرس العقل</option>
                  <option value="زراعة سن (Dental Implant)">زراعة أسنان</option>
                  <option value="تبييض أسنان بالزوم (Zoom Bleaching)">تبييض أسنان زوم</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  توقيت الجلسة:
                </label>
                <input
                  type="text"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  placeholder="11:30 AM"
                  className="w-full p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  الطبيب المعالج:
                </label>
                <select
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
                >
                  <option value="د. طارق الحسين">د. طارق الحسين</option>
                  <option value="د. سارة عادل">د. سارة عادل</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  درجة الأهمية:
                </label>
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value as any)}
                  className="w-full p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
                >
                  <option value="normal">عادي (مواعيد)</option>
                  <option value="urgent">طارئ (ألم شديد)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                ملاحظات أو شكوى المريض:
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ألم مع المشروبات الباردة، خلع سابق..."
                className="w-full p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              <span>إرسال وتحديث شاشة الطبيب بضغطة واحدة 🚀</span>
            </button>
          </form>
        </div>

        {/* Right Column (2 Cols): Live Reception Queue & Patient Callout */}
        <div className="lg:col-span-2 space-y-6">
          
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-emerald-600" />
                  جدول مواعيد اليوم والمُنادي الصوتي
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  استخدم المُنادي الصوتي (Gemini TTS) لنداء المريض ودخوله العيادة مباشرة.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  إجمالي اليوم: {appointments.length} مريض
                </span>
              </div>
            </div>

            {/* Appointments List Table */}
            <div className="space-y-3">
              {appointments.map((apt) => (
                <div
                  key={apt.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    apt.status === "in_chair"
                      ? "bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-700"
                      : apt.status === "completed"
                      ? "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 opacity-75"
                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-extrabold flex items-center justify-center text-sm shadow-xs">
                      {apt.time.split(" ")[0]}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                          {apt.patientName}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          apt.status === "in_chair"
                            ? "bg-amber-400 text-slate-950"
                            : apt.status === "completed"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
                        }`}>
                          {apt.status === "in_chair" ? "بالكرسي الآن" : apt.status === "completed" ? "مكتمل" : "في الانتظار"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {apt.procedure} • الطبيب: {apt.doctorName}
                      </p>
                    </div>
                  </div>

                  {/* Quick Reception Action Buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCallPatientVoice(apt)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
                      title="تشغيل المُنادي الصوتي للعيادة"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>نداء صوتي (Gemini TTS)</span>
                    </button>

                    <button
                      onClick={() => setSelectedAptForPayment(apt)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 transition-all"
                    >
                      <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                      <span>تحصيل حساب</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>

      </div>

      {/* Modal for Recording Patient Payment */}
      {selectedAptForPayment && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                تحصيل دفعة حساب للمريض
              </h3>
              <button
                onClick={() => setSelectedAptForPayment(null)}
                className="text-xs text-slate-400 hover:text-slate-600 font-bold"
              >
                إغلاق ✕
              </button>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl text-xs space-y-1">
              <div className="font-bold text-slate-900 dark:text-white">
                اسم المريض: {selectedAptForPayment.patientName}
              </div>
              <div className="text-slate-500 dark:text-slate-400">
                الإجراء: {selectedAptForPayment.procedure}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  المبلغ المحصل (جنية مصري EGP):
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(Number(e.target.value))}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-extrabold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  وسيلة الدفع:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["cash", "card", "instapay"] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                        paymentMethod === method
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-transparent"
                      }`}
                    >
                      {method === "cash" ? "نقداً (كاش)" : method === "card" ? "فيزا / بطاقة" : "انستا باي InstaPay"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleConfirmPayment}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all"
            >
              تأكيد تحصيل {paymentAmount} ج.م وإغلاق الحساب
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
