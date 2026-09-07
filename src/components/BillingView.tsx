import React, { useState } from 'react';
import { useClinic } from '../context/ClinicContext';
import { Invoice } from '../types/clinic';
import {
  Receipt,
  Search,
  Plus,
  Printer,
  DollarSign,
  CreditCard,
  CheckCircle,
  X
} from 'lucide-react';

export const BillingView: React.FC = () => {
  const {
    language,
    invoices,
    patients,
    doctors,
    addInvoice,
    updateInvoiceStatus,
    setInvoiceToPrint
  } = useClinic();

  const isAr = language === 'ar';

  const [search, setSearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Invoice State
  const [newInvoice, setNewInvoice] = useState({
    patientId: patients[0]?.id || '',
    doctorId: doctors[0]?.id || '',
    serviceDescription: 'كشف عيادة متخصصة',
    amount: 350,
    paymentMethod: 'Cash' as Invoice['paymentMethod'],
    status: 'Paid' as Invoice['status']
  });

  const filteredInvoices = invoices.filter(
    (inv) =>
      inv.patientName.toLowerCase().includes(search.toLowerCase()) ||
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase())
  );

  const totalCollected = invoices
    .filter((i) => i.status === 'Paid')
    .reduce((sum, i) => sum + i.grandTotal, 0);

  const totalPending = invoices
    .filter((i) => i.status === 'Pending')
    .reduce((sum, i) => sum + i.grandTotal, 0);

  const handleCreateInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    const patient = patients.find((p) => p.id === newInvoice.patientId);
    const doctor = doctors.find((d) => d.id === newInvoice.doctorId);

    if (!patient) return;

    addInvoice({
      patientId: patient.id,
      patientName: isAr ? patient.fullNameAr || patient.fullName : patient.fullName,
      doctorId: doctor?.id,
      doctorName: doctor?.name,
      date: new Date().toISOString().split('T')[0],
      items: [
        {
          id: '1',
          description: newInvoice.serviceDescription,
          quantity: 1,
          unitPrice: Number(newInvoice.amount),
          total: Number(newInvoice.amount)
        }
      ],
      subtotal: Number(newInvoice.amount),
      discount: 0,
      tax: 0,
      grandTotal: Number(newInvoice.amount),
      status: newInvoice.status,
      paymentMethod: newInvoice.paymentMethod
    });

    setIsAddModalOpen(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {isAr ? 'الفواتير وإصدار الايصالات المالية' : 'Invoices & Billing'}
          </h2>
          <p className="text-xs text-slate-500">
            {isAr ? 'إصدار فواتير الكشوفات والفحوصات، تحصيل المبالغ وطباعة السندات' : 'Create service invoices, process payments, and print financial receipts'}
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>{isAr ? 'إصدار فاتورة جديدة' : 'Create New Invoice'}</span>
        </button>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">{isAr ? 'إجمالي المقبوضات المسددة' : 'Total Paid Revenue'}</div>
            <div className="text-2xl font-black text-emerald-600 mt-1">{totalCollected} {isAr ? 'ج.م' : 'EGP'}</div>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">{isAr ? 'إجمالي المبالغ الآجلة (قيد التحصيل)' : 'Pending Payments'}</div>
            <div className="text-2xl font-black text-amber-600 mt-1">{totalPending} {isAr ? 'ج.م' : 'EGP'}</div>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <CreditCard className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Invoices List Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="relative max-w-sm w-full">
            <Search className={`absolute top-2.5 ${isAr ? 'right-3' : 'left-3'} w-4 h-4 text-slate-400`} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? 'بحث برقم الفاتورة أو اسم المريض...' : 'Search invoice # or patient...'}
              className={`w-full text-xs bg-slate-50 border border-slate-200 rounded-xl py-2 ${
                isAr ? 'pr-9 pl-3' : 'pl-9 pr-3'
              }`}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="p-3.5 text-start">{isAr ? 'رقم الفاتورة والتاريخ' : 'Invoice # & Date'}</th>
                <th className="p-3.5 text-start">{isAr ? 'اسم المريض' : 'Patient Name'}</th>
                <th className="p-3.5 text-start">{isAr ? 'طريقة الدفع' : 'Payment Method'}</th>
                <th className="p-3.5 text-start">{isAr ? 'المبلغ الإجمالي' : 'Grand Total'}</th>
                <th className="p-3.5 text-start">{isAr ? 'حالة السداد' : 'Status'}</th>
                <th className="p-3.5 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3.5 font-bold text-slate-900">
                    <div>{inv.invoiceNumber}</div>
                    <div className="text-[11px] font-normal text-slate-400">{inv.date}</div>
                  </td>

                  <td className="p-3.5 font-semibold text-slate-900">
                    {inv.patientName}
                  </td>

                  <td className="p-3.5 text-slate-600">
                    {inv.paymentMethod}
                  </td>

                  <td className="p-3.5 font-black text-slate-900 text-sm">
                    {inv.grandTotal} {isAr ? 'ج.م' : 'EGP'}
                  </td>

                  <td className="p-3.5">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        inv.status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {inv.status === 'Paid' ? (isAr ? 'مدفوعة بالكامل' : 'Paid') : (isAr ? 'غير مدفوعة' : 'Pending')}
                    </span>
                  </td>

                  <td className="p-3.5 text-end">
                    <div className="flex items-center justify-end gap-2">
                      {inv.status === 'Pending' && (
                        <button
                          onClick={() => updateInvoiceStatus(inv.id, 'Paid')}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs cursor-pointer"
                        >
                          {isAr ? 'تسديد' : 'Mark Paid'}
                        </button>
                      )}

                      <button
                        onClick={() => setInvoiceToPrint(inv)}
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors cursor-pointer"
                        title={isAr ? 'طباعة الايصال' : 'Print Receipt'}
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Invoice Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'إصدار فاتورة جديدة' : 'Create New Invoice'}
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInvoice} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{isAr ? 'اختر المريض' : 'Patient'}</label>
                <select
                  value={newInvoice.patientId}
                  onChange={(e) => setNewInvoice({ ...newInvoice, patientId: e.target.value })}
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
                <label className="block font-bold text-slate-700 mb-1">{isAr ? 'الخدمة المقدمة' : 'Service Description'}</label>
                <input
                  type="text"
                  required
                  value={newInvoice.serviceDescription}
                  onChange={(e) => setNewInvoice({ ...newInvoice, serviceDescription: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">{isAr ? 'المبلغ (ج.م)' : 'Amount (EGP)'}</label>
                <input
                  type="number"
                  value={newInvoice.amount}
                  onChange={(e) => setNewInvoice({ ...newInvoice, amount: Number(e.target.value) })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'طريقة الدفع' : 'Payment Method'}</label>
                  <select
                    value={newInvoice.paymentMethod}
                    onChange={(e) => setNewInvoice({ ...newInvoice, paymentMethod: e.target.value as any })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="Cash">{isAr ? 'نقداً (كاش)' : 'Cash'}</option>
                    <option value="Card">{isAr ? 'بطاقة ائتمان' : 'Card'}</option>
                    <option value="Insurance">{isAr ? 'تأمين طبي' : 'Insurance'}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'حالة الدفع' : 'Status'}</label>
                  <select
                    value={newInvoice.status}
                    onChange={(e) => setNewInvoice({ ...newInvoice, status: e.target.value as any })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="Paid">{isAr ? 'مسدد' : 'Paid'}</option>
                    <option value="Pending">{isAr ? 'قيد الانتظار' : 'Pending'}</option>
                  </select>
                </div>
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
                  {isAr ? 'حفظ وتأكيد' : 'Save Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
