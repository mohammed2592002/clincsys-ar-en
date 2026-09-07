import React, { useState } from 'react';
import { useClinic } from '../context/ClinicContext';
import { LabTest } from '../types/clinic';
import {
  TestTube,
  CheckCircle2,
  Clock,
  Plus,
  AlertCircle,
  FileSpreadsheet,
  X
} from 'lucide-react';

export const LabsView: React.FC = () => {
  const { language, labs, patients, doctors, addLabTest, updateLabResults } = useClinic();
  const isAr = language === 'ar';

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedLabForResults, setSelectedLabForResults] = useState<LabTest | null>(null);

  // New Lab Order Form
  const [newLabForm, setNewLabForm] = useState({
    patientId: patients[0]?.id || '',
    doctorId: doctors[0]?.id || '',
    testName: 'Lipid Profile & Cholesterol',
    category: 'Clinical Chemistry'
  });

  const [resultRows, setResultRows] = useState([
    { parameter: 'Total Cholesterol', value: '210', unit: 'mg/dL', referenceRange: '< 200', isAbnormal: true },
    { parameter: 'Triglycerides', value: '140', unit: 'mg/dL', referenceRange: '< 150', isAbnormal: false }
  ]);

  const handleCreateLab = (e: React.FormEvent) => {
    e.preventDefault();
    const patient = patients.find((p) => p.id === newLabForm.patientId);
    const doctor = doctors.find((d) => d.id === newLabForm.doctorId);

    if (!patient || !doctor) return;

    addLabTest({
      testName: newLabForm.testName,
      testNameAr: newLabForm.testName,
      patientId: patient.id,
      patientName: isAr ? patient.fullNameAr || patient.fullName : patient.fullName,
      doctorId: doctor.id,
      doctorName: doctor.name,
      orderDate: new Date().toISOString().split('T')[0],
      status: 'Pending',
      category: newLabForm.category
    });

    setIsAddModalOpen(false);
  };

  const handleSaveLabResults = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLabForResults) return;

    updateLabResults(selectedLabForResults.id, resultRows, 'Completed');
    setSelectedLabForResults(null);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {isAr ? 'المختبر والتحاليل الطبية' : 'Laboratory & Diagnostics'}
          </h2>
          <p className="text-xs text-slate-500">
            {isAr ? 'طلب التحاليل الطبية وإدخال نتائج الفحوصات المعملية للمرضى' : 'Order lab diagnostic panels and record laboratory test measurements'}
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>{isAr ? 'طلب تحليل جديد' : 'Order Lab Test'}</span>
        </button>
      </div>

      {/* Lab Tests Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="p-3.5 text-start">{isAr ? 'اسم التحليل' : 'Test Name'}</th>
                <th className="p-3.5 text-start">{isAr ? 'المريض' : 'Patient Name'}</th>
                <th className="p-3.5 text-start">{isAr ? 'الطبيب الموصي' : 'Doctor'}</th>
                <th className="p-3.5 text-start">{isAr ? 'تاريخ الطلب' : 'Order Date'}</th>
                <th className="p-3.5 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="p-3.5 text-end">{isAr ? 'النتائج' : 'Results / Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {labs.map((lab) => (
                <tr key={lab.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3.5">
                    <div className="font-bold text-slate-900">{lab.testName}</div>
                    <div className="text-[11px] text-slate-500">{lab.category}</div>
                  </td>

                  <td className="p-3.5 font-bold text-slate-900">
                    {lab.patientName}
                  </td>

                  <td className="p-3.5 text-slate-700">
                    {lab.doctorName}
                  </td>

                  <td className="p-3.5 text-slate-500">
                    {lab.orderDate}
                  </td>

                  <td className="p-3.5">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        lab.status === 'Completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : lab.status === 'In Analysis'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {lab.status === 'Completed'
                        ? (isAr ? 'مكتمل ومعتمد' : 'Completed')
                        : lab.status === 'In Analysis'
                        ? (isAr ? 'قيد التحليل' : 'In Analysis')
                        : (isAr ? 'معلق' : 'Pending')}
                    </span>
                  </td>

                  <td className="p-3.5 text-end">
                    {lab.status === 'Completed' && lab.results ? (
                      <button
                        onClick={() => setSelectedLabForResults(lab)}
                        className="px-3 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 rounded-lg font-bold text-xs cursor-pointer"
                      >
                        {isAr ? 'عرض النتيجة' : 'View Results'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setSelectedLabForResults(lab)}
                        className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold text-xs cursor-pointer"
                      >
                        {isAr ? 'إدخال النتائج' : 'Enter Results'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Lab Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'طلب تحليل مختبر جديد' : 'Order Lab Test'}
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateLab} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{isAr ? 'المريض' : 'Patient'}</label>
                <select
                  value={newLabForm.patientId}
                  onChange={(e) => setNewLabForm({ ...newLabForm, patientId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {isAr ? p.fullNameAr || p.fullName : p.fullName} ({p.fileNumber})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">{isAr ? 'اسم الفحص / التحليل' : 'Test Name'}</label>
                <input
                  type="text"
                  required
                  value={newLabForm.testName}
                  onChange={(e) => setNewLabForm({ ...newLabForm, testName: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors cursor-pointer"
                >
                  {isAr ? 'تأكيد الطلب' : 'Submit Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record / View Results Modal */}
      {selectedLabForResults && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedLabForResults.testName}
                </h3>
                <p className="text-xs text-slate-500">
                  {isAr ? 'المريض:' : 'Patient:'} {selectedLabForResults.patientName}
                </p>
              </div>
              <button onClick={() => setSelectedLabForResults(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveLabResults} className="space-y-4 text-xs">
              <div className="space-y-2">
                {resultRows.map((row, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-4 gap-2 items-center">
                    <span className="font-bold text-slate-900 col-span-1">{row.parameter}</span>
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => {
                        const next = [...resultRows];
                        next[idx].value = e.target.value;
                        setResultRows(next);
                      }}
                      className="p-1.5 bg-white border border-slate-200 rounded-lg font-bold text-teal-900"
                    />
                    <span className="text-slate-500">{row.unit} (Ref: {row.referenceRange})</span>
                    <label className="flex items-center gap-1 text-[11px] font-bold text-rose-600">
                      <input
                        type="checkbox"
                        checked={row.isAbnormal}
                        onChange={(e) => {
                          const next = [...resultRows];
                          next[idx].isAbnormal = e.target.checked;
                          setResultRows(next);
                        }}
                      />
                      <span>{isAr ? 'غير طبيعي' : 'Abnormal'}</span>
                    </label>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedLabForResults(null)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  {isAr ? 'إغلاق' : 'Close'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors cursor-pointer"
                >
                  {isAr ? 'حفظ وتأكيد النتيجة' : 'Save & Approve Results'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
