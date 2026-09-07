import React from 'react';
import { useClinic } from '../context/ClinicContext';
import {
  Users,
  CalendarCheck,
  DollarSign,
  Pill,
  Clock,
  Play,
  CheckCircle2,
  AlertCircle,
  Plus,
  Sparkles,
  UserPlus,
  CalendarPlus,
  Receipt,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    language,
    patients,
    appointments,
    invoices,
    drugs,
    doctors,
    setActiveTab,
    updateAppointmentStatus,
    setActiveAppointmentId,
    setSelectedPatientId,
    openAiAssistantWithContext
  } = useClinic();

  const isAr = language === 'ar';
  const todayStr = new Date().toISOString().split('T')[0];

  // Stats calculations
  const totalPatients = patients.length;
  const todayAppointments = appointments.filter((a) => a.date === todayStr);
  const waitingQueue = appointments.filter(
    (a) => a.status === 'Waiting' || a.status === 'In Progress'
  );
  const activeInConsultation = appointments.find((a) => a.status === 'In Progress');
  
  const todayRevenue = invoices
    .filter((inv) => inv.status === 'Paid')
    .reduce((sum, inv) => sum + inv.grandTotal, 0);

  const lowStockDrugs = drugs.filter((d) => d.stockQuantity <= d.minStockLevel);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Welcome & Quick Action Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
        <div className="absolute top-0 end-0 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="space-y-1 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 text-teal-300 text-xs font-semibold border border-teal-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            {isAr ? 'العيادة تعمل بشكل مباشر اليوم' : 'Clinic Operational Live'}
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
            {isAr ? 'مرحباً بك في نظام إدارة العيادة' : 'Welcome to Clinic Dashboard'}
          </h2>
          <p className="text-slate-300 text-xs sm:text-sm max-w-xl">
            {isAr
              ? 'متابعة حركة المرضى اليومية، المواعيد المباشرة، الروشتات الإلكترونية، والصيدلية.'
              : 'Overview of daily patient flow, live queues, EHR consultations, and pharmacy.'}
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 relative z-10">
          <button
            onClick={() => {
              setSelectedPatientId(null);
              setActiveTab('patients');
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>{isAr ? 'إضافة مريض' : 'New Patient'}</span>
          </button>
          
          <button
            onClick={() => setActiveTab('appointments')}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            <CalendarPlus className="w-4 h-4 text-teal-400" />
            <span>{isAr ? 'حجز موعد' : 'Book Appointment'}</span>
          </button>

          <button
            onClick={() => setActiveTab('consultation')}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
          >
            <Play className="w-4 h-4" />
            <span>{isAr ? 'غرفة الكشف' : 'Examination Room'}</span>
          </button>
        </div>
      </div>

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Patients */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between transition-all hover:shadow-md">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">
              {isAr ? 'إجمالي المرضى المسجلين' : 'Total Registered Patients'}
            </span>
            <div className="text-2xl font-black text-slate-900">{totalPatients}</div>
            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md inline-block">
              +4 {isAr ? 'هذا الأسبوع' : 'this week'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: Queue */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between transition-all hover:shadow-md">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">
              {isAr ? 'في قائمة الانتظار اليوم' : 'Waiting Queue Today'}
            </span>
            <div className="text-2xl font-black text-amber-600">
              {waitingQueue.length}
            </div>
            <span className="text-[11px] font-semibold text-slate-500">
              {todayAppointments.length} {isAr ? 'إجمالي حوزات اليوم' : 'total today'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Revenue */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between transition-all hover:shadow-md">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">
              {isAr ? 'إيرادات اليوم المحصلة' : 'Today Collected Revenue'}
            </span>
            <div className="text-2xl font-black text-slate-900">
              {todayRevenue} <span className="text-xs font-bold text-slate-500">{isAr ? 'ج.م' : 'EGP'}</span>
            </div>
            <span className="text-[11px] font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md inline-block">
              {isAr ? 'محدث تلقائياً' : 'Auto-calculated'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        {/* Card 4: Pharmacy Low Stock */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between transition-all hover:shadow-md">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">
              {isAr ? 'تنبيهات نواقص الأدوية' : 'Low Stock Medication'}
            </span>
            <div className={`text-2xl font-black ${lowStockDrugs.length > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {lowStockDrugs.length}
            </div>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md inline-block ${
              lowStockDrugs.length > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600'
            }`}>
              {lowStockDrugs.length > 0
                ? (isAr ? 'يتطلب التزويد' : 'Needs reorder')
                : (isAr ? 'المخزون ممتاز' : 'Stock healthy')}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <Pill className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Live Active Consultation & Waiting Queue Ticker */}
      {activeInConsultation ? (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-teal-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-md animate-pulse">
              <Play className="w-6 h-6 fill-white" />
            </div>
            <div>
              <div className="text-xs font-bold text-teal-700 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                {isAr ? 'جاري الكشف الحالي الآن (رقم ' + activeInConsultation.queueNumber + ')' : 'Consultation In Progress (Queue #' + activeInConsultation.queueNumber + ')'}
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-0.5">
                {activeInConsultation.patientName}
              </h3>
              <p className="text-xs text-slate-600">
                {isAr ? 'الطبيب المعالج:' : 'Doctor:'} {activeInConsultation.doctorName} • {activeInConsultation.symptoms}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setActiveAppointmentId(activeInConsultation.id);
              setActiveTab('consultation');
            }}
            className="px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl text-xs shadow-sm transition-all cursor-pointer shrink-0"
          >
            {isAr ? 'متابعة الكشف والروشتة' : 'Continue Examination & EHR'}
          </button>
        </div>
      ) : waitingQueue.length > 0 ? (
        <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black text-lg shadow-sm">
              #{waitingQueue[0].queueNumber}
            </div>
            <div>
              <div className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                {isAr ? 'المريض التالي في قائمة الانتظار' : 'Next Patient in Queue'}
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-0.5">
                {waitingQueue[0].patientName}
              </h3>
              <p className="text-xs text-slate-600">
                {waitingQueue[0].doctorName} • {waitingQueue[0].time}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              updateAppointmentStatus(waitingQueue[0].id, 'In Progress');
              setActiveAppointmentId(waitingQueue[0].id);
              setActiveTab('consultation');
            }}
            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all cursor-pointer shrink-0"
          >
            {isAr ? 'استدعاء المريض وبدء الكشف' : 'Call Patient & Start Examination'}
          </button>
        </div>
      ) : null}

      {/* Main Grid Section: Today's Appointments & Doctor Schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Appointments Table */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'جدول مواعيد اليوم' : "Today's Appointments"}
              </h3>
              <p className="text-xs text-slate-500">
                {isAr ? 'إدارة المواعيد المباشرة وطابور الانتظار' : 'Live appointment timeline and status'}
              </p>
            </div>
            <button
              onClick={() => setActiveTab('appointments')}
              className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1 cursor-pointer"
            >
              <span>{isAr ? 'عرض الكل' : 'View All'}</span>
              {isAr ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>

          {/* Appointments List */}
          <div className="divide-y divide-slate-100 overflow-x-auto">
            {appointments.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                {isAr ? 'لا توجد مواعيد حالية' : 'No appointments scheduled'}
              </div>
            ) : (
              appointments.slice(0, 5).map((apt) => (
                <div key={apt.id} className="py-3 flex items-center justify-between gap-4 hover:bg-slate-50/80 rounded-xl px-2 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                      #{apt.queueNumber}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {apt.patientName}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="font-medium text-slate-700">{apt.doctorName}</span>
                        <span>•</span>
                        <span>{apt.time}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge & Quick Action */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        apt.status === 'In Progress'
                          ? 'bg-teal-100 text-teal-800 animate-pulse'
                          : apt.status === 'Waiting'
                          ? 'bg-amber-100 text-amber-800'
                          : apt.status === 'Completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {apt.status === 'In Progress'
                        ? (isAr ? 'في الكشف' : 'In Progress')
                        : apt.status === 'Waiting'
                        ? (isAr ? 'بالانتظار' : 'Waiting')
                        : apt.status === 'Completed'
                        ? (isAr ? 'مكتمل' : 'Completed')
                        : (isAr ? 'مجدول' : 'Scheduled')}
                    </span>

                    {apt.status === 'Waiting' && (
                      <button
                        onClick={() => {
                          updateAppointmentStatus(apt.id, 'In Progress');
                          setActiveAppointmentId(apt.id);
                          setActiveTab('consultation');
                        }}
                        className="p-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                        title={isAr ? 'بدء الكشف' : 'Start Consultation'}
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right 1 Col: Active Doctors & AI Assistant Card */}
        <div className="space-y-6">
          {/* Doctors On Duty */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              {isAr ? 'الأطباء المتواجدون اليوم' : 'Doctors On Duty'}
            </h3>

            <div className="space-y-3">
              {doctors.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-3">
                    <img
                      src={doc.avatarUrl}
                      alt={doc.name}
                      className="w-10 h-10 rounded-full object-cover border border-slate-200"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {isAr ? doc.nameAr : doc.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {isAr ? doc.specialtyAr : doc.specialty}
                      </div>
                    </div>
                  </div>

                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-2xs" title="Available" />
                </div>
              ))}
            </div>
          </div>

          {/* AI Clinical Helper Banner */}
          <div className="bg-gradient-to-br from-teal-900 to-slate-900 text-white rounded-2xl p-5 border border-teal-800/80 shadow-md space-y-3">
            <div className="flex items-center gap-2 text-amber-300 font-bold text-xs uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              <span>{isAr ? 'المساعد الذكي للتشخيص' : 'AI Diagnosis Helper'}</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {isAr
                ? 'استعن بذكاء جيميناي الطبي للاستفسار عن التفاعلات الدوائية أو اقتراح التقييم المبدئي للأعراض.'
                : 'Leverage Gemini AI for clinical decision support, drug interaction checks, and differential diagnosis.'}
            </p>
            <button
              onClick={() =>
                openAiAssistantWithContext({
                  topic: 'symptom_analysis',
                  prompt: isAr
                    ? 'اكتب لي اقتراحات حول الفحوصات المطلوبة لمريض يعاني من ارتفاع ضغط الدم وآلام في الصدر.'
                    : 'Provide suggested lab tests and guidelines for a patient presenting with hypertension and chest pain.'
                })
              }
              className="w-full py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
            >
              {isAr ? 'استشارة الذكاء الاصطناعي' : 'Ask AI Assistant'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
