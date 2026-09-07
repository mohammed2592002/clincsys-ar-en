import React, { useState } from "react";
import { PatientRecord, ToothDetail } from "../types";
import { OdontogramChart } from "./OdontogramChart";
import { Users, Search, Plus, Phone, AlertTriangle, Activity, Volume2, ShieldAlert, FileText, ChevronLeft } from "lucide-react";

interface PatientsRecordsViewProps {
  patients: PatientRecord[];
  onAddNewPatient: (pat: Partial<PatientRecord>) => void;
  onUpdatePatientTeeth: (patientId: string, toothNum: number, detail: ToothDetail) => void;
  onGenerateTTS: (text: string, voice?: string) => void;
}

export const PatientsRecordsView: React.FC<PatientsRecordsViewProps> = ({
  patients,
  onAddNewPatient,
  onUpdatePatientTeeth,
  onGenerateTTS,
}) => {
  const [selectedPatientId, setSelectedPatientId] = useState<string>(patients[0]?.id || "p-001");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);

  // New Patient Form
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAge, setNewAge] = useState(30);
  const [newGender, setNewGender] = useState<"male" | "female">("male");
  const [newMedical, setNewMedical] = useState("");
  const [newAllergies, setNewAllergies] = useState("");

  const filteredPatients = patients.filter(
    (p) => p.name.includes(searchQuery) || p.phone.includes(searchQuery) || p.id.includes(searchQuery)
  );

  const selectedPatient = patients.find((p) => p.id === selectedPatientId) || patients[0];

  const handleCreatePatient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    onAddNewPatient({
      name: newName,
      phone: newPhone || "01000000000",
      age: Number(newAge) || 30,
      gender: newGender,
      medicalHistory: newMedical ? newMedical.split(",").map((s) => s.trim()) : [],
      allergies: newAllergies ? newAllergies.split(",").map((s) => s.trim()) : [],
      notes: "تمت إضافته عبر شاشة سجلات المرضى",
    });

    setNewName("");
    setNewPhone("");
    setShowNewPatientModal(false);
  };

  const handleSpeakMedicalHistory = () => {
    if (!selectedPatient) return;
    const text = `ملف المريض ${selectedPatient.name}، العمر ${selectedPatient.age} سنة. التاريخ الطبي: ${selectedPatient.medicalHistory.join(", ") || "سليم"}. الحساسية: ${selectedPatient.allergies.join(", ") || "لا يوجد"}. إجمالي المدفوعات: ${selectedPatient.totalSpent} جنيه مصري.`;
    onGenerateTTS(text, "Kore");
  };

  return (
    <div className="space-y-6">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            سجلات المرضى ومخططات الأسنان (EHR Database)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            بحث وتعديل فوري بسرعة الشفت مع دعم قراءة الملف بالصوت (Gemini TTS).
          </p>
        </div>

        <button
          onClick={() => setShowNewPatientModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة ملف مريض جديد</span>
        </button>
      </div>

      {/* Main Grid: Left Patients Search List, Right Active Patient EHR Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Search List */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
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

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {filteredPatients.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedPatientId(p.id)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                  p.id === selectedPatient?.id
                    ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 shadow-xs scale-101"
                    : "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-emerald-300"
                }`}
              >
                <div>
                  <div className="font-extrabold text-xs text-slate-900 dark:text-white">
                    {p.name}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {p.phone} • {p.age} سنة
                  </div>
                </div>

                <ChevronLeft className="w-4 h-4 text-slate-400" />
              </div>
            ))}
          </div>
        </div>

        {/* Right Active Patient Record & Odontogram */}
        <div className="lg:col-span-2 space-y-6">
          {selectedPatient && (
            <>
              {/* Active Patient Summary Header Card */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white font-extrabold flex items-center justify-center text-xl shadow-xs">
                      {selectedPatient.name.charAt(0)}
                    </div>

                    <div>
                      <h3 className="text-base font-black text-slate-900 dark:text-white">
                        {selectedPatient.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        رقم الملف: #{selectedPatient.id} • {selectedPatient.phone}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleSpeakMedicalHistory}
                    className="flex items-center gap-2 px-3.5 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-xl text-xs font-bold transition-all"
                  >
                    <Volume2 className="w-4 h-4 text-emerald-600" />
                    <span>قراءة الملف الطبي بالصوت (Gemini TTS)</span>
                  </button>
                </div>

                {/* Medical History & Allergy Badges */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      التاريخ الطبي والتنبيهات:
                    </span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {selectedPatient.medicalHistory.join(" | ") || "لا يوجد أمراض مزمنة مسجلة"}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
                    <span className="font-bold text-rose-800 dark:text-rose-300 block mb-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                      الحساسية الدوائية (Allergies):
                    </span>
                    <span className="text-rose-900 dark:text-rose-200 font-bold">
                      {selectedPatient.allergies.join(", ") || "لا يوجد حساسية معروفة"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Patient FDI Odontogram Chart */}
              <OdontogramChart
                teethNotes={selectedPatient.teethNotes || {}}
                onUpdateTooth={(toothNum, detail) => onUpdatePatientTeeth(selectedPatient.id, toothNum, detail)}
                onGenerateAudioSummary={(text) => onGenerateTTS(text, "Kore")}
                patientName={selectedPatient.name}
              />
            </>
          )}
        </div>

      </div>

      {/* New Patient Registration Modal */}
      {showNewPatientModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-600" />
                إضافة ملف مريض جديد بالسستم
              </h3>
              <button
                onClick={() => setShowNewPatientModal(false)}
                className="text-xs text-slate-400 font-bold"
              >
                إغلاق ✕
              </button>
            </div>

            <form onSubmit={handleCreatePatient} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  اسم المريض الكامل: *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    رقم الهاتف: *
                  </label>
                  <input
                    type="text"
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    العمر:
                  </label>
                  <input
                    type="number"
                    value={newAge}
                    onChange={(e) => setNewAge(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  التاريخ الطبي (أمراض مزمنة):
                </label>
                <input
                  type="text"
                  value={newMedical}
                  onChange={(e) => setNewMedical(e.target.value)}
                  placeholder="مثال: ضغط دم، سكري..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  الحساسية الدوائية (Allergies):
                </label>
                <input
                  type="text"
                  value={newAllergies}
                  onChange={(e) => setNewAllergies(e.target.value)}
                  placeholder="مثال: Penicillin"
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl shadow-md transition-all"
              >
                حفظ وإنشاء ملف المريض
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
