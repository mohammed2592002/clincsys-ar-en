import React, { useState } from 'react';
import { useClinic } from '../context/ClinicContext';
import { DrugItem } from '../types/clinic';
import {
  Pill,
  Search,
  Plus,
  AlertTriangle,
  CheckCircle,
  PackageCheck,
  TrendingDown,
  X
} from 'lucide-react';

export const PharmacyView: React.FC = () => {
  const { language, drugs, addDrug, updateDrugStock } = useClinic();
  const isAr = language === 'ar';

  const [search, setSearch] = useState('');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Drug Form
  const [newDrugForm, setNewDrugForm] = useState({
    drugName: '',
    genericName: '',
    category: 'Analgesic',
    dosageForm: 'Tablet' as DrugItem['dosageForm'],
    strength: '500 mg',
    stockQuantity: 100,
    minStockLevel: 20,
    unitPrice: 30,
    expiryDate: '2027-12-31',
    location: 'Shelf A-1'
  });

  const filteredDrugs = drugs.filter((d) => {
    const matchesSearch =
      d.drugName.toLowerCase().includes(search.toLowerCase()) ||
      d.genericName.toLowerCase().includes(search.toLowerCase()) ||
      d.category.toLowerCase().includes(search.toLowerCase());

    const matchesLowStock = !filterLowStock || d.stockQuantity <= d.minStockLevel;

    return matchesSearch && matchesLowStock;
  });

  const handleAddDrug = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDrugForm.drugName) return;

    addDrug({
      drugName: newDrugForm.drugName,
      genericName: newDrugForm.genericName || newDrugForm.drugName,
      category: newDrugForm.category,
      dosageForm: newDrugForm.dosageForm,
      strength: newDrugForm.strength,
      stockQuantity: Number(newDrugForm.stockQuantity),
      minStockLevel: Number(newDrugForm.minStockLevel),
      unitPrice: Number(newDrugForm.unitPrice),
      expiryDate: newDrugForm.expiryDate,
      location: newDrugForm.location
    });

    setIsAddModalOpen(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {isAr ? 'الصيدلية ومخزون الأدوية والمستلزمات' : 'Pharmacy & Drug Inventory'}
          </h2>
          <p className="text-xs text-slate-500">
            {isAr ? 'متابعة كميات الدواء، تنبيهات النواقص، والصرف المباشر للمرضى' : 'Track pharmaceutical stock, minimum reorder thresholds, and direct medication dispensing'}
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>{isAr ? 'إضافة دواء جديد للمخزون' : 'Add Medication Stock'}</span>
        </button>
      </div>

      {/* Search & Low Stock Toggle Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="relative flex-1 max-w-md">
          <Search className={`absolute top-2.5 ${isAr ? 'right-3' : 'left-3'} w-4 h-4 text-slate-400`} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'بحث بالاسم التجاري، المادة الفعالة، التصنيف...' : 'Search brand name, generic name, category...'}
            className={`w-full bg-slate-50 border border-slate-200 rounded-xl py-2 ${
              isAr ? 'pr-9 pl-3' : 'pl-9 pr-3'
            } focus:outline-hidden focus:ring-2 focus:ring-teal-500 focus:bg-white`}
          />
        </div>

        <button
          onClick={() => setFilterLowStock(!filterLowStock)}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold transition-colors cursor-pointer ${
            filterLowStock
              ? 'bg-rose-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>{isAr ? 'عرض النواقص فقط' : 'Show Low Stock Only'}</span>
        </button>
      </div>

      {/* Drugs Inventory Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="p-3.5 text-start">{isAr ? 'اسم الدواء والمادة الفعالة' : 'Drug & Generic Name'}</th>
                <th className="p-3.5 text-start">{isAr ? 'التصنيف والشكل' : 'Category & Form'}</th>
                <th className="p-3.5 text-start">{isAr ? 'التركيز' : 'Strength'}</th>
                <th className="p-3.5 text-center">{isAr ? 'الكمية بالمخزون' : 'Stock Level'}</th>
                <th className="p-3.5 text-start">{isAr ? 'السعر (ج.م)' : 'Unit Price'}</th>
                <th className="p-3.5 text-start">{isAr ? 'تاريخ الصلاحية' : 'Expiry Date'}</th>
                <th className="p-3.5 text-end">{isAr ? 'صرف / تعديل' : 'Dispense / Adjust'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {filteredDrugs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400">
                    {isAr ? 'لا توجد أدوية مطابقة للبحث' : 'No medications found'}
                  </td>
                </tr>
              ) : (
                filteredDrugs.map((drug) => {
                  const isLow = drug.stockQuantity <= drug.minStockLevel;
                  return (
                    <tr key={drug.id} className={`hover:bg-slate-50/80 transition-colors ${isLow ? 'bg-rose-50/30' : ''}`}>
                      <td className="p-3.5">
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <Pill className="w-4 h-4 text-teal-600" />
                          <span>{drug.drugName}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">{drug.genericName}</div>
                      </td>

                      <td className="p-3.5">
                        <span className="font-semibold text-slate-800">{drug.category}</span>
                        <div className="text-[11px] text-slate-400">{drug.dosageForm}</div>
                      </td>

                      <td className="p-3.5 font-semibold text-slate-700">
                        {drug.strength}
                      </td>

                      <td className="p-3.5 text-center">
                        <span
                          className={`inline-block px-3 py-1 rounded-full font-black text-xs ${
                            isLow ? 'bg-rose-100 text-rose-800 animate-pulse' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {drug.stockQuantity}
                        </span>
                      </td>

                      <td className="p-3.5 font-bold text-slate-900">
                        {drug.unitPrice} {isAr ? 'ج.م' : 'EGP'}
                      </td>

                      <td className="p-3.5 text-slate-600">
                        {drug.expiryDate}
                      </td>

                      <td className="p-3.5 text-end">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => updateDrugStock(drug.id, -1)}
                            disabled={drug.stockQuantity <= 0}
                            className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded-lg font-bold text-xs transition-colors cursor-pointer"
                          >
                            {isAr ? 'صرف عبوة' : 'Dispense 1'}
                          </button>
                          <button
                            onClick={() => updateDrugStock(drug.id, 10)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold text-xs transition-colors cursor-pointer"
                          >
                            +10
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Drug Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'إضافة صنف دوائي جديد' : 'Add New Drug Batch'}
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddDrug} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'الاسم التجاري' : 'Brand Name'}</label>
                  <input
                    type="text"
                    required
                    value={newDrugForm.drugName}
                    onChange={(e) => setNewDrugForm({ ...newDrugForm, drugName: e.target.value })}
                    placeholder="e.g. Norvasc"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'المادة الفعالة' : 'Generic Name'}</label>
                  <input
                    type="text"
                    value={newDrugForm.genericName}
                    onChange={(e) => setNewDrugForm({ ...newDrugForm, genericName: e.target.value })}
                    placeholder="e.g. Amlodipine"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'الكمية الابتدائية' : 'Stock Quantity'}</label>
                  <input
                    type="number"
                    value={newDrugForm.stockQuantity}
                    onChange={(e) => setNewDrugForm({ ...newDrugForm, stockQuantity: Number(e.target.value) })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'سعر الوحدة (ج.م)' : 'Unit Price'}</label>
                  <input
                    type="number"
                    value={newDrugForm.unitPrice}
                    onChange={(e) => setNewDrugForm({ ...newDrugForm, unitPrice: Number(e.target.value) })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
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
                  {isAr ? 'حفظ الصنف' : 'Save Drug'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
