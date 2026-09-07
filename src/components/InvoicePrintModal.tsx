import React from 'react';
import { useClinic } from '../context/ClinicContext';
import { Printer, X, Receipt } from 'lucide-react';

export const InvoicePrintModal: React.FC = () => {
  const { invoiceToPrint, setInvoiceToPrint, language } = useClinic();

  if (!invoiceToPrint) return null;

  const isAr = language === 'ar';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top Control Bar */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between no-print">
          <span className="font-bold text-sm">
            {isAr ? 'معاينة الايصال المالي للطباعة' : 'Invoice Receipt Preview'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{isAr ? 'طباعة الايصال' : 'Print Invoice'}</span>
            </button>
            <button
              onClick={() => setInvoiceToPrint(null)}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Invoice Paper Printable Content */}
        <div className="p-8 space-y-6 text-slate-900 font-sans overflow-y-auto flex-1 bg-white">
          <div className="text-center border-b pb-4 space-y-1">
            <h2 className="text-xl font-black text-teal-800">إيصال تحصيل مالي / فاتورة خدمة</h2>
            <div className="text-xs font-bold text-slate-600">MediCare Medical Center</div>
            <div className="text-[11px] text-slate-400">رقم الفاتورة: {invoiceToPrint.invoiceNumber}</div>
          </div>

          <div className="flex justify-between text-xs font-semibold bg-slate-50 p-3 rounded-xl">
            <div>
              <span className="text-slate-400">المريض:</span> {invoiceToPrint.patientName}
            </div>
            <div>
              <span className="text-slate-400">التاريخ:</span> {invoiceToPrint.date}
            </div>
          </div>

          <table className="w-full text-xs text-start">
            <thead className="border-b font-bold text-slate-500">
              <tr>
                <th className="py-2 text-start">البيان / الخدمة</th>
                <th className="py-2 text-center">الكمية</th>
                <th className="py-2 text-end">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoiceToPrint.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="py-2.5 font-bold text-slate-800">{item.description}</td>
                  <td className="py-2.5 text-center">{item.quantity}</td>
                  <td className="py-2.5 text-end font-bold">{item.total} ج.م</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t-2 border-slate-900 pt-3 flex justify-between items-center text-sm font-black">
            <span>المبلغ الإجمالي المسدد:</span>
            <span className="text-teal-800 text-lg">{invoiceToPrint.grandTotal} ج.م</span>
          </div>

          <div className="text-center text-[10px] text-slate-400 pt-6">
            شكراً لثقتكم بعياداتنا • تم التحصيل بواسطة: الخزينة الرئيسية ({invoiceToPrint.paymentMethod})
          </div>
        </div>
      </div>
    </div>
  );
};
