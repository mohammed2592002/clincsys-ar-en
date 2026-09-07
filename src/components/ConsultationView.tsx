import React, { useState, useEffect } from 'react';
import { useClinic } from '../context/ClinicContext';
import { PrescriptionItem, MedicalRecord } from '../types/clinic';
import {
  Stethoscope,
  Sparkles,
  Heart,
  Plus,
  Trash2,
  Printer,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  Pill,
  FileText,
  ShieldAlert,
  Activity
} from 'lucide-react';

export const ConsultationView: React.FC = () => {
  const {
    language,
    patients,
    doctors,
    appointments,
    activeAppointmentId,
    drugs,
    addMedicalRecord,
    addInvoice,
    addLabTest,
    setPrescriptionToPrint,
    openAiAssistantWithContext,
    setActiveTab
  } = useClinic();

  const isAr = language === 'ar';

  const activeAppointment = appointments.find((a) => a.id === activeAppointmentId) || appointments[0];
  const activePatient = patients.find((p) => p.id === activeAppointment?.patientId) || patients[0];
  const activeDoctor = doctors.find((d) => d.id === activeAppointment?.doctorId) || doctors[0];

  // Examination State
  const [vitals, setVitals] = useState({
    bloodPressure: '120/80',
    heartRate: 75,
    temperature: 36.6,
    spo2: 98,
    weight: 75,
    height: 172
  });

  const [chiefComplaint, setChiefComplaint] = useState(activeAppointment?.symptoms || '');
  const [diagnosis, setDiagnosis] = useState('');
  const [icdCode, setIcdCode] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  
  // Prescriptions list
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([
    {
      id: '1',
      drugName: 'Panadol Extra',
      dosage: '500 mg',
      frequency: 'كل 8 ساعات عند الحاجة',
      duration: '5 أيام',
      instructions: 'بعد الأكل مع كوب ماء وفير',
      dispensed: false
    }
  ]);

  // Selected Lab Orders
  const [selectedLabs, setSelectedLabs] = useState<string[]>([]);
  
  // New drug input form inside prescription builder
  const [newDrug, setNewDrug] = useState({
    drugName: '',
    dosage: '1 قرص',
    frequency: 'مرتان يومياً',
    duration: '7 أيام',
    instructions: 'بعد الأكل'
  });

  const [savedRecord, setSavedRecord] = useState<MedicalRecord | null>(null);

  useEffect(() => {
    if (activeAppointment?.symptoms) {
      setChiefComplaint(activeAppointment.symptoms);
    }
  }, [activeAppointmentId]);

  const handleAddDrugToPrescription = () => {
    if (!newDrug.drugName) return;
    const item: PrescriptionItem = {
      id: Date.now().toString(),
      drugName: newDrug.drugName,
      dosage: newDrug.dosage,
      frequency: newDrug.frequency,
      duration: newDrug.duration,
      instructions: newDrug.instructions,
      dispensed: false
    };
    setPrescriptions([...prescriptions, item]);
    setNewDrug({
      drugName: '',
      dosage: '1 قرص',
      frequency: 'مرتان يومياً',
      duration: '7 أيام',
      instructions: 'بعد الأكل'
    });
  };

  const handleRemoveDrug = (id: string) => {
    setPrescriptions(prescriptions.filter((p) => p.id !== id));
  };

  const handleSaveConsultation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePatient || !activeDoctor) return;

    const record = addMedicalRecord({
      patientId: activePatient.id,
      doctorId: activeDoctor.id,
      doctorName: activeDoctor.name,
      appointmentId: activeAppointment?.id,
      date: new Date().toISOString().split('T')[0],
      vitals,
      chiefComplaint,
      diagnosis: diagnosis || 'General Medical Consultation',
      icdCode,
      clinicalNotes,
      prescriptions,
      labOrders: selectedLabs
    });

    // Auto-create Consultation Invoice
    addInvoice({
      patientId: activePatient.id,
      patientName: isAr ? activePatient.fullNameAr : activePatient.fullName,
      doctorId: activeDoctor.id,
      doctorName: activeDoctor.name,
      date: new Date().toISOString().split('T')[0],
      items: [
        {
          id: '1',
          description: `كشف طبي - ${activeDoctor.specialtyAr} (${activeDoctor.nameAr})`,
          quantity: 1,
          unitPrice: activeDoctor.consultationFee,
          total: activeDoctor.consultationFee
        }
      ],
      subtotal: activeDoctor.consultationFee,
      discount: 0,
      tax: 0,
      grandTotal: activeDoctor.consultationFee,
      status: 'Paid',
      paymentMethod: 'Cash'
    });

    // Register requested lab orders if any
    selectedLabs.forEach((labName) => {
      addLabTest({
        testName: labName,
        testNameAr: labName,
        patientId: activePatient.id,
        patientName: activePatient.fullName,
        doctorId: activeDoctor.id,
        doctorName: activeDoctor.name,
        orderDate: new Date().toISOString().split('T')[0],
        status: 'Pending',
        category: 'Clinical Diagnostics'
      });
    });

    setSavedRecord(record);
  };

  // Check for allergy warnings between patient's allergies and prescribed drug names
  const allergyAlerts = activePatient?.allergies.filter((a) =>
    prescriptions.some((p) => p.drugName.toLowerCase().includes(a.toLowerCase()))
  ) || [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Title & Active Patient Summary Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-teal-600 flex items-center justify-center text-white shadow-md">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold text-teal-400 uppercase tracking-wider">
              {isAr ? 'شاشة الكشف الطبي الإلكتروني (EHR Examination)' : 'Electronic Examination & EHR'}
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5">
              {isAr ? activePatient?.fullNameAr || activePatient?.fullName : activePatient?.fullName}
            </h2>
            <div className="text-xs text-slate-300 flex items-center gap-2 mt-0.5">
              <span>{activePatient?.fileNumber}</span>
              <span>•</span>
              <span>{activePatient?.gender === 'male' ? (isAr ? 'ذكر' : 'Male') : (isAr ? 'أنثى' : 'Female')}, {activePatient?.age} {isAr ? 'سنة' : 'yrs'}</span>
              <span>•</span>
              <span className="text-emerald-400 font-bold">{activePatient?.bloodType}</span>
            </div>
          </div>
        </div>

        {/* AI Clinical Trigger */}
        <button
          onClick={() =>
            openAiAssistantWithContext({
              patientName: activePatient?.fullName,
              allergies: activePatient?.allergies,
              complaint: chiefComplaint,
              prescriptions: prescriptions.map((p) => p.drugName),
              prompt: isAr
                ? `يرجى مراجعة التفاعلات الدوائية المحتملة والتشخيص لمريض يعاني من: ${chiefComplaint} وتم وصف: ${prescriptions.map((p) => p.drugName).join(', ')}`
                : `Check for potential drug interaction or clinical guidelines for symptoms: ${chiefComplaint}`
            })
          }
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black rounded-xl text-xs shadow-md transition-all cursor-pointer self-start md:self-auto"
        >
          <Sparkles className="w-4 h-4 fill-slate-950" />
          <span>{isAr ? 'استشارة الذكاء الاصطناعي للحالة' : 'AI Drug & Clinical Check'}</span>
        </button>
      </div>

      {/* Allergy Warning Banner if triggered */}
      {allergyAlerts.length > 0 && (
        <div className="p-4 bg-rose-50 border-2 border-rose-500 text-rose-900 rounded-2xl flex items-center gap-3 animate-bounce">
          <ShieldAlert className="w-6 h-6 text-rose-600 shrink-0" />
          <div className="text-xs font-bold">
            {isAr
              ? `تحذير طبي عاجل: المريض لديه حساسيات مسجلة قد تتعارض مع الأدوية الموصوفة (${allergyAlerts.join(', ')})!`
              : `Medical Warning: Patient has documented allergies matching prescribed medication (${allergyAlerts.join(', ')})!`}
          </div>
        </div>
      )}

      {/* Examination Form & EHR Builder */}
      <form onSubmit={handleSaveConsultation} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Vitals & Diagnosis (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* 1. Vitals Entry */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
              <Heart className="w-4 h-4 text-rose-500" />
              <span>{isAr ? 'العلامات الحيوية (Vitals)' : 'Patient Vitals'}</span>
            </h3>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 font-bold mb-1">{isAr ? 'ضغط الدم' : 'Blood Pressure'}</label>
                <input
                  type="text"
                  value={vitals.bloodPressure}
                  onChange={(e) => setVitals({ ...vitals, bloodPressure: e.target.value })}
                  placeholder="120/80"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1">{isAr ? 'نبض القلب (bpm)' : 'Heart Rate'}</label>
                <input
                  type="number"
                  value={vitals.heartRate}
                  onChange={(e) => setVitals({ ...vitals, heartRate: Number(e.target.value) })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1">{isAr ? 'درجة الحرارة (°C)' : 'Temperature'}</label>
                <input
                  type="number"
                  step="0.1"
                  value={vitals.temperature}
                  onChange={(e) => setVitals({ ...vitals, temperature: Number(e.target.value) })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1">{isAr ? 'نسبة الأكسجين SpO2 (%)' : 'SpO2 %'}</label>
                <input
                  type="number"
                  value={vitals.spo2}
                  onChange={(e) => setVitals({ ...vitals, spo2: Number(e.target.value) })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1">{isAr ? 'الوزن (كجم)' : 'Weight (kg)'}</label>
                <input
                  type="number"
                  value={vitals.weight}
                  onChange={(e) => setVitals({ ...vitals, weight: Number(e.target.value) })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1">{isAr ? 'الطول (سم)' : 'Height (cm)'}</label>
                <input
                  type="number"
                  value={vitals.height}
                  onChange={(e) => setVitals({ ...vitals, height: Number(e.target.value) })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* 2. Chief Complaint & Diagnosis */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
              {isAr ? 'الشكوى المباشرة والتشخيص الطبي' : 'Chief Complaint & Diagnosis'}
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">{isAr ? 'شكوى المريض والأعراض' : 'Chief Complaint'}</label>
                <textarea
                  rows={2}
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  placeholder={isAr ? 'اكتب شكوى المريض المباشرة...' : 'Patient chief complaint...'}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">{isAr ? 'التشخيص الطبي النهائي' : 'Medical Diagnosis'}</label>
                <input
                  type="text"
                  required
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder={isAr ? 'مثال: التهاب حاد بالشعب الهوائية / ارتفاع ضغط الدم' : 'e.g. Acute Bronchitis / Essential Hypertension'}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-teal-900 focus:bg-white"
                />

                {/* Quick Diagnosis Pills */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    isAr ? 'ارتفاع ضغط الدم' : 'Hypertension',
                    isAr ? 'التهاب الشعب الهوائية' : 'Bronchitis',
                    isAr ? 'نزلة برد وحمى' : 'Acute Pharyngitis',
                    isAr ? 'خشونة المفاصل' : 'Osteoarthritis'
                  ].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDiagnosis(d)}
                      className="px-2 py-1 bg-slate-100 hover:bg-teal-100 hover:text-teal-800 text-slate-600 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer"
                    >
                      + {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">{isAr ? 'ملاحظات الكشف والفحص الإكلينيكي' : 'Clinical Notes'}</label>
                <textarea
                  rows={3}
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  placeholder={isAr ? 'تفاصيل الفحص، سماعة الطبيب، نصائح نمط الحياة...' : 'Examination findings and doctor instructions...'}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: E-Prescription Builder & Lab Orders (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* E-Prescription Builder Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Pill className="w-4 h-4 text-teal-600" />
                <span>{isAr ? 'إصدار الروشتة الإلكترونية (E-Prescription)' : 'E-Prescription Builder'}</span>
              </h3>
            </div>

            {/* Prescribed Items Table */}
            <div className="space-y-2">
              {prescriptions.map((p, idx) => (
                <div key={p.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold text-slate-900">
                      {idx + 1}. {p.drugName} ({p.dosage})
                    </div>
                    <div className="text-teal-700 font-medium">
                      {p.frequency} • {p.duration}
                    </div>
                    {p.instructions && <div className="text-slate-500 text-[11px]">{p.instructions}</div>}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveDrug(p.id)}
                    className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Drug Input Subform */}
            <div className="p-3 bg-teal-50/50 border border-teal-200/80 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-teal-900">
                {isAr ? 'إضافة دواء جديد للروشتة:' : 'Add Drug to Prescription:'}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">{isAr ? 'اسم الدواء (من المخزون أو إدخال)' : 'Drug Name'}</label>
                  <input
                    type="text"
                    value={newDrug.drugName}
                    onChange={(e) => setNewDrug({ ...newDrug, drugName: e.target.value })}
                    placeholder={isAr ? 'مثال: Augmentin 1g' : 'e.g. Augmentin 1g'}
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg"
                  />
                  {/* Quick Suggestions from Pharmacy */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {drugs.slice(0, 4).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setNewDrug({ ...newDrug, drugName: d.drugName })}
                        className="text-[10px] bg-white border border-slate-200 text-slate-700 hover:bg-teal-100 px-1.5 py-0.5 rounded-md"
                      >
                        {d.drugName}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">{isAr ? 'الجرعة' : 'Dosage'}</label>
                  <input
                    type="text"
                    value={newDrug.dosage}
                    onChange={(e) => setNewDrug({ ...newDrug, dosage: e.target.value })}
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">{isAr ? 'التكرار' : 'Frequency'}</label>
                  <input
                    type="text"
                    value={newDrug.frequency}
                    onChange={(e) => setNewDrug({ ...newDrug, frequency: e.target.value })}
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">{isAr ? 'مدة العلاج' : 'Duration'}</label>
                  <input
                    type="text"
                    value={newDrug.duration}
                    onChange={(e) => setNewDrug({ ...newDrug, duration: e.target.value })}
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddDrugToPrescription}
                className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-center gap-1"
              >
                <Plus className="w-4 h-4" />
                <span>{isAr ? 'إضافة الدواء للروشتة' : 'Add Medication'}</span>
              </button>
            </div>
          </div>

          {/* Action Buttons Bar: Save Record, Print Prescription, Issue Invoice */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <button
              type="submit"
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-black rounded-xl text-xs shadow-md transition-all cursor-pointer flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isAr ? 'حفظ الكشف وإصدار الروشتة بالفاتورة' : 'Save Examination & Prescription'}</span>
            </button>

            {savedRecord && (
              <button
                type="button"
                onClick={() => setPrescriptionToPrint(savedRecord)}
                className="px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs shadow-sm transition-all cursor-pointer flex items-center gap-2 animate-bounce"
              >
                <Printer className="w-4 h-4 text-teal-400" />
                <span>{isAr ? 'معاينة وطباعة الروشتة الآن' : 'Print Official Prescription'}</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
