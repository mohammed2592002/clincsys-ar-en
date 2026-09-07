import React from 'react';
import { useClinic } from '../context/ClinicContext';
import { Printer, X, Activity } from 'lucide-react';

export const PrescriptionPrintModal: React.FC = () => {
  const { prescriptionToPrint, setPrescriptionToPrint, patients, doctors, language } = useClinic();

  if (!prescriptionToPrint) return null;

  const isAr = language === 'ar';

  const patient = patients.find((p) => p.id === prescriptionToPrint.patientId);
  const doctor = doctors.find((d) => d.id === prescriptionToPrint.doctorId);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top Control Bar */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between no-print">
          <span className="font-bold text-sm">
            {isAr ? 'معاينة الروشتة الطبية للطباعة' : 'Medical Prescription Print Preview'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{isAr ? 'طباعة الروشتة (Print)' : 'Print Prescription'}</span>
            </button>
            <button
              onClick={() => setPrescriptionToPrint(null)}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Prescription Paper (Printable Region) */}
        <div id="prescription-paper" dir={isAr ? "rtl" : "ltr"} className="p-8 space-y-6 text-slate-900 font-sans overflow-y-auto flex-1 bg-white">
          {/* Clinic Header */}
          <div className="flex items-center justify-between border-b-2 border-teal-600 pb-4">
            <div className="space-y-1">
              <h2 className="text-xl font-black text-teal-800 tracking-tight">
                {isAr ? (doctor?.nameAr || doctor?.name || 'د. أحمد السيد') : (doctor?.nameEn || doctor?.name || 'Dr. Ahmed El-Sayed')}
              </h2>
              <div className="text-xs font-bold text-slate-700">
                {isAr ? (doctor?.title || 'استشاري القلب والأوعية الدموية') : (doctor?.titleEn || doctor?.title || 'Cardiovascular Consultant')}
              </div>
              <div className="text-[11px] text-slate-500">
                {doctor?.department} • {isAr ? 'عيادات ميدي كير التخصصية' : 'MediCare Specialty Clinics'}
              </div>
            </div>

            <div className="text-end space-y-1">
              <div className="w-10 h-10 rounded-xl bg-teal-600 text-white font-black text-lg flex items-center justify-center ms-auto">
                <Activity className="w-6 h-6" />
              </div>
              <div className="text-[11px] font-bold text-slate-600">MediCare Medical Center</div>
              <div className="text-[10px] text-slate-400">Tel: +20 100 123 4567</div>
            </div>
          </div>

          {/* Patient Info Bar */}
          <div className="grid grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs font-semibold">
            <div>
              <span className="text-slate-400">{isAr ? 'اسم المريض:' : 'Patient Name:'}</span>
              <div className="font-bold text-slate-900">{isAr ? (patient?.fullNameAr || patient?.fullName) : (patient?.fullNameEn || patient?.fullName)}</div>
            </div>
            <div>
              <span className="text-slate-400">{isAr ? 'رقم الملف:' : 'File #:'}</span>
              <div className="font-bold text-teal-700">{patient?.fileNumber}</div>
            </div>
            <div>
              <span className="text-slate-400">{isAr ? 'العمر / السن:' : 'Age:'}</span>
              <div className="font-bold text-slate-900">{patient?.age} {isAr ? 'سنة' : 'yrs'}</div>
            </div>
            <div>
              <span className="text-slate-400">{isAr ? 'التاريخ:' : 'Date:'}</span>
              <div className="font-bold text-slate-900">{prescriptionToPrint.date}</div>
            </div>
          </div>

          {/* Diagnosis & Vitals */}
          <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-3">
            <div>
              <span className="text-slate-500 font-bold">{isAr ? 'التشخيص الطبي:' : 'Diagnosis:'}</span>{' '}
              <strong className="text-teal-900 font-bold">{prescriptionToPrint.diagnosis}</strong>
            </div>
            <div className="text-slate-500 font-mono text-[11px]">
              BP: {prescriptionToPrint.vitals.bloodPressure} | HR: {prescriptionToPrint.vitals.heartRate} bpm | Temp: {prescriptionToPrint.vitals.temperature}°C
            </div>
          </div>

          {/* Rx Symbol & Medication List */}
          <div className="space-y-4">
            <div className="text-3xl font-black text-teal-700 italic font-serif">Rx</div>

            <div className="divide-y divide-slate-100">
              {prescriptionToPrint.prescriptions.map((item, idx) => (
                <div key={idx} className="py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm text-slate-900">
                      {idx + 1}. {item.drugName} ({item.dosage})
                    </span>
                    <span className="text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md">
                      {item.duration}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 font-semibold pe-4">
                    • {isAr ? 'الجرعة والتكرار:' : 'Dose & Frequency:'} {item.frequency}
                  </div>
                  {item.instructions && (
                    <div className="text-[11px] text-slate-500 italic pe-4">
                      {isAr ? 'ملاحظات الاستعمال:' : 'Instructions:'} {item.instructions}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Doctor Signature & Clinic Footer */}
          <div className="pt-8 border-t-2 border-slate-200 flex items-end justify-between">
            <div className="text-[10px] text-slate-400 space-y-0.5">
              <div>{isAr ? 'نتمنى لكم الشفاء العاجل - عيادات ميدي كير التخصصية' : 'Wishing you a speedy recovery - MediCare Specialty Clinics'}</div>
              <div>{isAr ? 'يرجى إحضار هذه الروشتة عند الإعادة' : 'Please bring this prescription for your follow-up visit'}</div>
            </div>

            <div className="text-center space-y-2">
              <div className="text-xs font-bold text-slate-700">{isAr ? 'توقيع وختم الطبيب المعالج' : 'Doctor Signature'}</div>
              <div className="w-32 h-10 border-b-2 border-slate-300 mx-auto flex items-center justify-center text-xs font-mono text-slate-400">
                [Signed]
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
