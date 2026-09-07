import React, { useState } from 'react';
import { useClinic } from '../context/ClinicContext';
import { Patient, MedicalRecord } from '../types/clinic';
import { formatEgyptianPhoneInput, isValidEgyptianPhone, getEgyptianPhoneError } from '../utils/phoneUtils';
import {
  Users,
  Search,
  UserPlus,
  Filter,
  FileText,
  Phone,
  Mail,
  Heart,
  AlertTriangle,
  Calendar,
  Clock,
  Printer,
  ChevronRight,
  ChevronLeft,
  X,
  Plus,
  ShieldAlert,
  Activity,
  Receipt,
  TestTube
} from 'lucide-react';

export const PatientsView: React.FC = () => {
  const {
    language,
    patients,
    selectedPatientId,
    setSelectedPatientId,
    addPatient,
    medicalRecords,
    invoices,
    labs,
    setPrescriptionToPrint,
    setInvoiceToPrint,
    setActiveTab
  } = useClinic();

  const isAr = language === 'ar';

  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Patient Form State
  const [newPatientForm, setNewPatientForm] = useState({
    fullName: '',
    fullNameAr: '',
    gender: 'male' as 'male' | 'female',
    age: 30,
    dob: '1995-01-01',
    phone: '',
    email: '',
    bloodType: 'O+' as Patient['bloodType'],
    allergies: '',
    chronicConditions: '',
    emergencyName: '',
    emergencyPhone: '',
    nationalId: '',
    address: '',
    notes: ''
  });

  const filteredPatients = patients.filter((p) => {
    const matchesSearch =
      p.fullName.toLowerCase().includes(search.toLowerCase()) ||
      p.fullNameAr.includes(search) ||
      p.fileNumber.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search);

    const matchesGender = genderFilter === 'all' || p.gender === genderFilter;

    return matchesSearch && matchesGender;
  });

  const selectedPatient = patients.find((p) => p.id === selectedPatientId) || patients[0];

  const patientRecords = selectedPatient
    ? medicalRecords.filter((r) => r.patientId === selectedPatient.id)
    : [];

  const patientInvoices = selectedPatient
    ? invoices.filter((i) => i.patientId === selectedPatient.id)
    : [];

  const patientLabs = selectedPatient
    ? labs.filter((l) => l.patientId === selectedPatient.id)
    : [];

  const handleCreatePatient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientForm.fullName && !newPatientForm.fullNameAr) return;

    const cleanPhone = formatEgyptianPhoneInput(newPatientForm.phone);
    const phoneErr = getEgyptianPhoneError(cleanPhone, true, isAr ? 'رقم الهاتف' : 'Phone Number');
    if (phoneErr) {
      alert(phoneErr);
      return;
    }

    const created = addPatient({
      fullName: newPatientForm.fullName || newPatientForm.fullNameAr,
      fullNameAr: newPatientForm.fullNameAr || newPatientForm.fullName,
      gender: newPatientForm.gender,
      age: Number(newPatientForm.age),
      dob: newPatientForm.dob,
      phone: cleanPhone,
      email: newPatientForm.email,
      bloodType: newPatientForm.bloodType,
      allergies: newPatientForm.allergies
        ? newPatientForm.allergies.split(',').map((s) => s.trim())
        : [],
      chronicConditions: newPatientForm.chronicConditions
        ? newPatientForm.chronicConditions.split(',').map((s) => s.trim())
        : [],
      emergencyContact: {
        name: newPatientForm.emergencyName || 'Emergency Contact',
        relationship: 'Relative',
        phone: newPatientForm.emergencyPhone ? formatEgyptianPhoneInput(newPatientForm.emergencyPhone) : cleanPhone
      },
      nationalId: newPatientForm.nationalId || '29000000000000',
      address: newPatientForm.address || 'Cairo, Egypt',
      notes: newPatientForm.notes
    });

    setSelectedPatientId(created.id);
    setIsAddModalOpen(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Title & Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {isAr ? 'سجلات المرضى والأرشيف الطبي' : 'Patient Records Directory'}
          </h2>
          <p className="text-xs text-slate-500">
            {isAr ? 'إدارة بيانات المرضى، التاريخ الطبي، الروشتات السابقة والفواتير' : 'Manage patient profiles, EHR history, past prescriptions, and invoices'}
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>{isAr ? 'تسجيل مريض جديد' : 'Register New Patient'}</span>
        </button>
      </div>

      {/* Main Content Layout: Patient List (Left) & Detailed Patient EHR (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Patient Directory Search & Cards (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Search & Filter */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            <div className="relative">
              <Search className={`absolute top-2.5 ${isAr ? 'right-3' : 'left-3'} w-4 h-4 text-slate-400`} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? 'بحث بالاسم، الملف، الهوية...' : 'Search name, file #, phone...'}
                className={`w-full text-xs bg-slate-50 border border-slate-200 rounded-xl py-2 ${
                  isAr ? 'pr-9 pl-3' : 'pl-9 pr-3'
                } focus:outline-hidden focus:ring-2 focus:ring-teal-500 focus:bg-white`}
              />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-medium">{isAr ? 'النوع:' : 'Gender:'}</span>
              {(['all', 'male', 'female'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGenderFilter(g)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                    genderFilter === g
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {g === 'all'
                    ? (isAr ? 'الكل' : 'All')
                    : g === 'male'
                    ? (isAr ? 'ذكور' : 'Male')
                    : (isAr ? 'إناث' : 'Female')}
                </button>
              ))}
            </div>
          </div>

          {/* Patients List Cards */}
          <div className="space-y-2.5 max-h-[650px] overflow-y-auto pr-1">
            {filteredPatients.map((p) => {
              const isSelected = selectedPatient?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedPatientId(p.id)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-teal-50/80 border-teal-500 shadow-xs'
                      : 'bg-white border-slate-200/80 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={p.avatarUrl}
                      alt={p.fullName}
                      className="w-10 h-10 rounded-full object-cover border border-slate-200"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-900 truncate">
                          {isAr ? p.fullNameAr || p.fullName : p.fullName}
                        </h4>
                        <span className="text-[10px] font-bold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-md">
                          {p.fileNumber}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-1">
                        <span>{p.gender === 'male' ? (isAr ? 'رجل' : 'Male') : (isAr ? 'أنثى' : 'Female')} • {p.age} {isAr ? 'سنة' : 'yrs'}</span>
                        <span>•</span>
                        <span className="font-semibold text-slate-700">{p.bloodType}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Active Patient Electronic File (8 Cols) */}
        <div className="lg:col-span-8 space-y-6">
          {selectedPatient ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
              {/* Header Banner */}
              <div className="bg-slate-900 text-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <img
                    src={selectedPatient.avatarUrl}
                    alt={selectedPatient.fullName}
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-teal-500 shadow-md"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold">
                        {isAr ? selectedPatient.fullNameAr || selectedPatient.fullName : selectedPatient.fullName}
                      </h3>
                      <span className="bg-teal-500/20 text-teal-300 text-xs px-2.5 py-0.5 rounded-full font-mono border border-teal-500/30">
                        {selectedPatient.fileNumber}
                      </span>
                    </div>
                    <div className="text-xs text-slate-300 flex flex-wrap items-center gap-3 mt-1">
                      <span>{selectedPatient.gender === 'male' ? (isAr ? 'ذكر' : 'Male') : (isAr ? 'أنثى' : 'Female')}, {selectedPatient.age} {isAr ? 'سنة' : 'yrs'}</span>
                      <span>•</span>
                      <span>{isAr ? 'فصيلة الدم:' : 'Blood:'} <strong className="text-emerald-400">{selectedPatient.bloodType}</strong></span>
                      <span>•</span>
                      <span>{selectedPatient.phone}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setActiveTab('consultation')}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer shrink-0"
                >
                  {isAr ? 'فتح كشف جديد للمريض' : 'Start Consultation'}
                </button>
              </div>

              {/* Patient Medical Alerts Bar (Allergies & Chronic Conditions) */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-4 text-xs">
                {/* Allergies Alert */}
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
                  <span className="font-bold text-slate-700">{isAr ? 'الحساسية:' : 'Allergies:'}</span>
                  {selectedPatient.allergies.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {selectedPatient.allergies.map((a, i) => (
                        <span key={i} className="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-md text-[11px]">
                          {a}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-400">{isAr ? 'لا توجد حساسيات مسجلة' : 'None reported'}</span>
                  )}
                </div>

                {/* Chronic Conditions */}
                <div className="flex items-center gap-2 border-s border-slate-300 ps-4">
                  <Activity className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-bold text-slate-700">{isAr ? 'الأمراض المزمنة:' : 'Chronic:'}</span>
                  {selectedPatient.chronicConditions.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {selectedPatient.chronicConditions.map((c, i) => (
                        <span key={i} className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-md text-[11px]">
                          {c}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-400">{isAr ? 'لا توجد' : 'None'}</span>
                  )}
                </div>
              </div>

              {/* EHR History Tabs / Section */}
              <div className="p-6 space-y-6">
                {/* 1. Past Visits & Prescriptions */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-2 flex items-center justify-between">
                    <span>{isAr ? 'سجل الزيارات والكشوفات السابقة' : 'Past Visits & Examinations History'}</span>
                    <span className="text-xs text-slate-500 font-normal">
                      {patientRecords.length} {isAr ? 'زيارة' : 'visit(s)'}
                    </span>
                  </h4>

                  {patientRecords.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      {isAr ? 'لا توجد سجلات كشف سابقة هذا المريض' : 'No previous visit records found'}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {patientRecords.map((rec) => (
                        <div key={rec.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-teal-600" />
                              <span className="text-xs font-bold text-slate-900">{rec.date}</span>
                              <span className="text-xs text-slate-500">• {rec.doctorName}</span>
                            </div>
                            <button
                              onClick={() => setPrescriptionToPrint(rec)}
                              className="flex items-center gap-1.5 px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>{isAr ? 'طباعة الروشتة' : 'Print Prescription'}</span>
                            </button>
                          </div>

                          {/* Vitals Summary */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-white p-2.5 rounded-xl border border-slate-200">
                            <div><span className="text-slate-400">{isAr ? 'ضغط الدم:' : 'BP:'}</span> <strong className="text-slate-800">{rec.vitals.bloodPressure}</strong></div>
                            <div><span className="text-slate-400">{isAr ? 'النبض:' : 'Heart Rate:'}</span> <strong className="text-slate-800">{rec.vitals.heartRate} bpm</strong></div>
                            <div><span className="text-slate-400">{isAr ? 'الحرارة:' : 'Temp:'}</span> <strong className="text-slate-800">{rec.vitals.temperature} °C</strong></div>
                            <div><span className="text-slate-400">{isAr ? 'الوزن:' : 'Weight:'}</span> <strong className="text-slate-800">{rec.vitals.weight} kg</strong></div>
                          </div>

                          {/* Diagnosis & Prescription Items */}
                          <div className="space-y-1">
                            <div className="text-xs font-bold text-teal-800">
                              {isAr ? 'التشخيص:' : 'Diagnosis:'} <span className="text-slate-800 font-semibold">{rec.diagnosis}</span>
                            </div>
                            <p className="text-xs text-slate-600">{rec.clinicalNotes}</p>
                          </div>

                          {/* Prescribed Drugs */}
                          {rec.prescriptions.length > 0 && (
                            <div className="space-y-1 pt-1">
                              <div className="text-[11px] font-bold text-slate-500 uppercase">
                                {isAr ? 'الأدوية الموصوفة بالروشتة:' : 'Prescribed Medications:'}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {rec.prescriptions.map((p, idx) => (
                                  <div key={idx} className="bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-lg text-xs">
                                    <strong className="text-teal-900">{p.drugName} ({p.dosage})</strong> - <span className="text-teal-700">{p.frequency}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Billing / Invoices History */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-2">
                    {isAr ? 'سجل الفواتير والمستحقات' : 'Billing & Payment History'}
                  </h4>

                  {patientInvoices.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-xs">
                      {isAr ? 'لا توجد فواتير مسجلة' : 'No invoices for this patient'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {patientInvoices.map((inv) => (
                        <div key={inv.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-bold text-slate-900">{inv.invoiceNumber} • {inv.date}</div>
                            <div className="text-slate-500">{inv.items.length} {isAr ? 'بند' : 'item(s)'} • {inv.paymentMethod}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-black text-slate-900 text-sm">{inv.grandTotal} {isAr ? 'ج.م' : 'EGP'}</span>
                            <button
                              onClick={() => setInvoiceToPrint(inv)}
                              className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg transition-colors cursor-pointer"
                              title={isAr ? 'طباعة الفاتورة' : 'Print Invoice'}
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
              {isAr ? 'اختر مريضاً من القائمة لعرض السجل الطبي الكامل' : 'Select a patient from the list to view EHR'}
            </div>
          )}
        </div>
      </div>

      {/* Register Patient Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'تسجيل مريض جديد بالعيادة' : 'Register New Patient'}
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePatient} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'الاسم بالعربية' : 'Arabic Full Name'}</label>
                  <input
                    type="text"
                    required
                    value={newPatientForm.fullNameAr}
                    onChange={(e) => setNewPatientForm({ ...newPatientForm, fullNameAr: e.target.value })}
                    placeholder="مثال: أحمد محمود علي"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'الاسم بالإنجليزية' : 'English Full Name'}</label>
                  <input
                    type="text"
                    value={newPatientForm.fullName}
                    onChange={(e) => setNewPatientForm({ ...newPatientForm, fullName: e.target.value })}
                    placeholder="e.g. Ahmed Mahmoud Ali"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {isAr ? 'رقم الهاتف' : 'Phone Number'}
                    <span className="text-xs text-slate-400 font-normal mr-1">(11 رقم يبدأ بـ 01)</span>
                  </label>
                  <input
                    type="tel"
                    required
                    maxLength={11}
                    inputMode="numeric"
                    value={newPatientForm.phone}
                    onChange={(e) => setNewPatientForm({ ...newPatientForm, phone: formatEgyptianPhoneInput(e.target.value) })}
                    placeholder="01012345678"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500 font-mono font-bold"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'النوع / الجنس' : 'Gender'}</label>
                  <select
                    value={newPatientForm.gender}
                    onChange={(e) => setNewPatientForm({ ...newPatientForm, gender: e.target.value as any })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="male">{isAr ? 'ذكر' : 'Male'}</option>
                    <option value="female">{isAr ? 'أنثى' : 'Female'}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'العمر (بالسنوات)' : 'Age (Years)'}</label>
                  <input
                    type="number"
                    value={newPatientForm.age}
                    onChange={(e) => setNewPatientForm({ ...newPatientForm, age: Number(e.target.value) })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'فصيلة الدم' : 'Blood Type'}</label>
                  <select
                    value={newPatientForm.bloodType}
                    onChange={(e) => setNewPatientForm({ ...newPatientForm, bloodType: e.target.value as any })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                  >
                    {['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((bt) => (
                      <option key={bt} value={bt}>{bt}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'الحساسية (افصل بفاصلة)' : 'Allergies (comma separated)'}</label>
                  <input
                    type="text"
                    value={newPatientForm.allergies}
                    onChange={(e) => setNewPatientForm({ ...newPatientForm, allergies: e.target.value })}
                    placeholder="Penicillin, Dust..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'الأمراض المزمنة' : 'Chronic Conditions'}</label>
                  <input
                    type="text"
                    value={newPatientForm.chronicConditions}
                    onChange={(e) => setNewPatientForm({ ...newPatientForm, chronicConditions: e.target.value })}
                    placeholder="Diabetes, Hypertension..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors cursor-pointer"
                >
                  {isAr ? 'حفظ وتسجيل' : 'Save & Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
