import React, { useState, useEffect, useRef } from 'react';
import { db, doc, deleteDoc, getRenewalsRef, getClinicRef, getDocsSmart as getDocs, addDoc, updateDoc } from '../dbClient';
import { Clinic, RenewalRecord } from '../types';
import { 
  Receipt, 
  Search, 
  Calendar, 
  DollarSign, 
  Plus, 
  RefreshCw, 
  AlertCircle, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  X, 
  Building2, 
  Clock, 
  Sparkles, 
  CalendarPlus, 
  CalendarDays,
  Trash2,
  RotateCcw
} from 'lucide-react';
import { useDialogs } from './DialogContext';

interface AdminRenewalsProps {
  clinics: Clinic[];
  onRefreshClinics: () => Promise<void>;
}

export default function AdminRenewals({ clinics, onRefreshClinics }: AdminRenewalsProps) {
  const dialogs = useDialogs();
  const [renewals, setRenewals] = useState<RenewalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Renewal form state
  const [isAdding, setIsAdding] = useState(false);
  
  // Searchable Clinic Dropdown State
  const [selectedClinicId, setSelectedClinicId] = useState('');
  const [clinicSearchQuery, setClinicSearchQuery] = useState('');
  const [isClinicDropdownOpen, setIsClinicDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Duration State (Presets vs Custom)
  const [durationMode, setDurationMode] = useState<'preset' | 'custom'>('preset');
  const [presetMonths, setPresetMonths] = useState<number>(1);
  const [customType, setCustomType] = useState<'days' | 'months' | 'exact_date'>('months');
  const [customDays, setCustomDays] = useState<number>(30);
  const [customMonths, setCustomMonths] = useState<number>(2);
  const [customExactDate, setCustomExactDate] = useState<string>(() => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth.toISOString().split('T')[0];
  });
  const [startFromOption, setStartFromOption] = useState<'auto' | 'today'>('auto');

  const [amount, setAmount] = useState<number>(500);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'wallet' | 'card' | 'instapay'>('cash');
  const [notes, setNotes] = useState('');

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsClinicDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchRenewals = async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(getRenewalsRef());
      const list: RenewalRecord[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          clinicId: data.clinicId || '',
          clinicName: data.clinicName || '',
          oldExpiry: data.oldExpiry || '',
          newExpiry: data.newExpiry || '',
          renewedAt: data.renewedAt || '',
          amount: Number(data.amount) || 0,
          paymentMethod: data.paymentMethod || data.method || 'cash',
          notes: data.notes || ''
        });
      });
      // Sort newest first
      list.sort((a, b) => (b.renewedAt || '').localeCompare(a.renewedAt || ''));
      setRenewals(list);
    } catch (err: any) {
      console.error(err);
      setError('فشل تحميل سجل تجديد الاشتراكات: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRenewals();
  }, []);

  // Selected Clinic object
  const selectedClinic = clinics.find((c) => c.id === selectedClinicId);

  // Helper to calculate new expiry date
  const calculateNewExpiryDate = (): Date => {
    let baseDate = new Date();
    if (startFromOption === 'auto' && selectedClinic?.subscriptionExpiresAt) {
      const currentExpiry = new Date(selectedClinic.subscriptionExpiresAt);
      if (!isNaN(currentExpiry.getTime()) && currentExpiry > baseDate) {
        baseDate = currentExpiry;
      }
    }

    if (durationMode === 'preset') {
      const res = new Date(baseDate);
      res.setMonth(res.getMonth() + Number(presetMonths || 1));
      return res;
    } else {
      if (customType === 'days') {
        const res = new Date(baseDate);
        res.setDate(res.getDate() + Number(customDays || 1));
        return res;
      } else if (customType === 'months') {
        const res = new Date(baseDate);
        res.setMonth(res.getMonth() + Number(customMonths || 1));
        return res;
      } else if (customType === 'exact_date' && customExactDate) {
        const parsed = new Date(customExactDate + 'T23:59:59');
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
      const res = new Date(baseDate);
      res.setMonth(res.getMonth() + 1);
      return res;
    }
  };

  const handleCreateRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClinicId) {
      dialogs.alert('يرجى تحديد العيادة المراد تجديد اشتراكها من القائمة', { severity: 'warning' });
      return;
    }

    const clinic = clinics.find((c) => c.id === selectedClinicId);
    if (!clinic) {
      dialogs.alert('العيادة المحددة غير موجودة', { severity: 'error' });
      return;
    }

    const newExpiry = calculateNewExpiryDate();
    if (isNaN(newExpiry.getTime())) {
      dialogs.alert('تاريخ انتهاء الاشتراك غير صالح، يرجى مراجعة المدة المحددة', { severity: 'error' });
      return;
    }

    setLoading(true);
    try {
      const newExpiryIso = newExpiry.toISOString();
      const oldExpiryIso = clinic.subscriptionExpiresAt || new Date().toISOString();

      // 1. Update clinic subscriptionExpiresAt and activate clinic
      const clinicDocRef = getClinicRef(clinic.id);
      await updateDoc(clinicDocRef, {
        subscriptionExpiresAt: newExpiryIso,
        isActive: true
      });

      // 2. Log in global renewals collection
      let durationNote = '';
      if (durationMode === 'preset') {
        durationNote = `${presetMonths} شهر`;
      } else if (customType === 'days') {
        durationNote = `فترة مخصصة: ${customDays} يوم`;
      } else if (customType === 'months') {
        durationNote = `فترة مخصصة: ${customMonths} شهر`;
      } else {
        durationNote = `فترة مخصصة حتى: ${customExactDate}`;
      }

      await addDoc(getRenewalsRef(), {
        clinicId: clinic.id,
        clinicName: clinic.name,
        oldExpiry: oldExpiryIso,
        newExpiry: newExpiryIso,
        renewedAt: new Date().toISOString(),
        amount: Number(amount) || 0,
        paymentMethod: paymentMethod,
        notes: notes.trim() ? `${notes.trim()} (${durationNote})` : durationNote
      });

      dialogs.alert(`تم تجديد اشتراك عيادة "${clinic.name}" بنجاح حتى ${formatArabicDate(newExpiryIso)}!`, { severity: 'success' });

      setIsAdding(false);
      setSelectedClinicId('');
      setClinicSearchQuery('');
      setDurationMode('preset');
      setPresetMonths(1);
      setCustomDays(30);
      setCustomMonths(2);
      setAmount(500);
      setPaymentMethod('cash');
      setNotes('');

      // Refresh all lists
      await onRefreshClinics();
      await fetchRenewals();
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء حفظ عملية التجديد: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRenewal = async (record: RenewalRecord) => {
    const formattedOldExpiry = record.oldExpiry ? formatArabicDate(record.oldExpiry) : 'تاريخ البداية الأصلي';
    const amountStr = (Number(record.amount) || 0).toLocaleString();

    const isConfirmed = await dialogs.confirm(
      `هل أنت متأكد من رغبتك في حذف سجل التجديد هذا لعيادة "${record.clinicName}"؟\n\n` +
      `• سيتم استرجاع تاريخ انتهاء الاشتراك السابق للعيادة إلى: ${formattedOldExpiry}\n` +
      `• سيتم خصم مبلغ (${amountStr} ج.م) بالكامل من إجمالي الاشتراكات وحسابات الإيرادات.\n\n` +
      `هل تريد تأكيد الحذف والاسترجاع؟`,
      {
        title: 'حذف التجديد واسترجاع تاريخ الاشتراك السابق',
        confirmText: 'نعم، احذف التجديد واسترجع التاريخ',
        cancelText: 'إلغاء التراجع',
        severity: 'danger'
      }
    );

    if (!isConfirmed) return;

    setDeletingId(record.id);
    setError(null);
    try {
      // 1. Delete renewal document from database
      const renewalDocRef = doc(db, 'renewals', record.id);
      await deleteDoc(renewalDocRef);

      // 2. Revert the clinic's subscription expiry date (keep isActive: true so it's classified by expiry date as Expired, not manually Suspended)
      if (record.clinicId) {
        const clinicDocRef = getClinicRef(record.clinicId);
        const restoredExpiry = record.oldExpiry || '';

        await updateDoc(clinicDocRef, {
          subscriptionExpiresAt: restoredExpiry,
          isActive: true
        });
      }

      dialogs.alert(
        `تم حذف سجل التجديد بنجاح، وتم استرجاع تاريخ اشتراك عيادة "${record.clinicName}" إلى (${formattedOldExpiry}) وخصم ${amountStr} ج.م من الإيرادات.`,
        { severity: 'success' }
      );

      // Refresh both clinics and renewals list
      await onRefreshClinics();
      await fetchRenewals();
    } catch (err: any) {
      console.error('Error deleting renewal:', err);
      setError('حدث خطأ أثناء حذف سجل التجديد: ' + (err.message || err.toString()));
    } finally {
      setDeletingId(null);
    }
  };

  // Filter clinics for the searchable dropdown
  const filteredClinicsForDropdown = clinics.filter((c) => {
    const q = clinicSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.nameAr || '').toLowerCase().includes(q) ||
      (c.nameEn || '').toLowerCase().includes(q) ||
      (c.doctorName || '').toLowerCase().includes(q) ||
      (c.doctorPhone || '').includes(q) ||
      (c.id || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  });

  const filteredRenewals = renewals.filter((r) =>
    r.clinicName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatArabicDate = (isoString: string): string => {
    if (!isoString) return 'غير محدد';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return 'غير صالح';
      return d.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return isoString;
    }
  };

  const isClinicExpired = (expiryStr?: string) => {
    if (!expiryStr) return true;
    const d = new Date(expiryStr);
    return isNaN(d.getTime()) || d < new Date();
  };

  const getDaysRemainingText = (expiryStr?: string) => {
    if (!expiryStr) return 'غير محدد';
    const exp = new Date(expiryStr);
    if (isNaN(exp.getTime())) return 'غير صالح';
    const now = new Date();
    const diffMs = exp.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) {
      return `منتهي منذ ${Math.abs(diffDays)} يوم`;
    }
    return `متبقي ${diffDays} يوم`;
  };

  const calculatedNewExpiry = calculateNewExpiryDate();

  return (
    <div className="space-y-6 animate-fade-in" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Receipt className="h-6 w-6 text-indigo-600" />
            سجل وتتبع عمليات تجديد الاشتراكات
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            مراجعة كافة المعاملات المالية وفترات التجديد التي قام بها المشرف لتفعيل أو تمديد اشتراكات العيادات.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setIsAdding(!isAdding);
              if (!isAdding) {
                setIsClinicDropdownOpen(false);
              }
            }}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition shadow-md shadow-indigo-100 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            {isAdding ? 'إغلاق نموذج التجديد' : 'تجديد جديد لعيادة'}
          </button>
          <button
            onClick={fetchRenewals}
            className="p-2.5 text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition cursor-pointer"
            title="تحديث البيانات"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-rose-50 border-r-4 border-rose-500 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-rose-800 text-sm">تنبيه:</h4>
            <p className="text-xs text-rose-700 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* Add Renewal Form */}
      {isAdding && (
        <form onSubmit={handleCreateRenewal} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                <CalendarPlus className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-800">تسجيل وتأكيد تجديد اشتراك عيادة</h3>
                <p className="text-xs text-slate-400">حدد العيادة وفترة التجديد المطلوبة وسيتم تفعيل الحساب وتمديد الصلاحية فوراً</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* 1. Searchable Clinic Selector (5 Cols) */}
            <div className="lg:col-span-5 space-y-1.5" ref={dropdownRef}>
              <label className="block text-xs font-bold text-slate-700">
                حدد العيادة المراد تجديدها <span className="text-rose-500">*</span>
              </label>

              {/* Custom Searchable Dropdown Button */}
              <div className="relative">
                <div
                  onClick={() => setIsClinicDropdownOpen(!isClinicDropdownOpen)}
                  className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between gap-2 bg-white ${
                    isClinicDropdownOpen
                      ? 'border-indigo-500 ring-2 ring-indigo-100 shadow-xs'
                      : selectedClinic
                      ? 'border-indigo-200 bg-indigo-50/30'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {selectedClinic ? (
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center text-xs shrink-0 shadow-xs">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                          {selectedClinic.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate flex items-center gap-2">
                          <span>{selectedClinic.doctorName || 'طبيب الأسنان'}</span>
                          {selectedClinic.doctorPhone && (
                            <span className="text-slate-400 font-mono">({selectedClinic.doctorPhone})</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-slate-400 text-xs sm:text-sm">
                      <Search className="h-4 w-4" />
                      <span>-- اضغط للبحث واختيار العيادة --</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 shrink-0">
                    {selectedClinic && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClinicId('');
                          setClinicSearchQuery('');
                        }}
                        className="p-1 text-slate-400 hover:text-rose-500 rounded-md hover:bg-slate-100 transition"
                        title="إلغاء التحديد"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {isClinicDropdownOpen ? (
                      <ChevronUp className="h-4 w-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    )}
                  </div>
                </div>

                {/* Dropdown Menu with Search input & Clinics List */}
                {isClinicDropdownOpen && (
                  <div className="absolute top-full right-0 left-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden animate-fade-in">
                    {/* Search Input inside Dropdown */}
                    <div className="p-2.5 border-b border-slate-100 bg-slate-50">
                      <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          autoFocus
                          value={clinicSearchQuery}
                          onChange={(e) => setClinicSearchQuery(e.target.value)}
                          placeholder="ابحث باسم العيادة، اسم الطبيب، أو رقم الهاتف..."
                          className="w-full pl-3 pr-9 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                        />
                        {clinicSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setClinicSearchQuery('')}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5 px-1 font-medium">
                        <span>النتائج: ({filteredClinicsForDropdown.length} عيادة)</span>
                        <span className="text-indigo-600">اختر بالضغط على العيادة</span>
                      </div>
                    </div>

                    {/* Scrollable Clinics list */}
                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 p-1">
                      {filteredClinicsForDropdown.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 text-xs">
                          <AlertCircle className="h-6 w-6 mx-auto mb-1.5 text-slate-300" />
                          لا توجد عيادة مطابقة لكلمة البحث "{clinicSearchQuery}"
                        </div>
                      ) : (
                        filteredClinicsForDropdown.map((c) => {
                          const isSelected = c.id === selectedClinicId;
                          const expired = isClinicExpired(c.subscriptionExpiresAt);
                          const remainingText = getDaysRemainingText(c.subscriptionExpiresAt);

                          return (
                            <div
                              key={c.id}
                              onClick={() => {
                                setSelectedClinicId(c.id);
                                setIsClinicDropdownOpen(false);
                              }}
                              className={`p-2.5 rounded-xl cursor-pointer transition flex items-center justify-between gap-3 ${
                                isSelected
                                  ? 'bg-indigo-50 text-indigo-950 font-bold border border-indigo-200'
                                  : 'hover:bg-slate-50 text-slate-800'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold flex items-center gap-1.5">
                                  <span>{c.name}</span>
                                  {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600 inline" />}
                                </div>
                                <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                                  <span>{c.doctorName || 'طبيب الأسنان'}</span>
                                  {c.doctorPhone && (
                                    <span className="font-mono text-slate-400">({c.doctorPhone})</span>
                                  )}
                                </div>
                              </div>

                              <div className="shrink-0 text-left">
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1 ${
                                    expired
                                      ? 'bg-rose-50 text-rose-600 border border-rose-200'
                                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  }`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${expired ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                                  {remainingText}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Clinic Current Status Card */}
              {selectedClinic && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5 animate-fade-in mt-2">
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="font-bold flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-500" />
                      تاريخ نهاية الاشتراك الحالي:
                    </span>
                    <span className="font-mono font-bold text-slate-900" dir="ltr">
                      {formatArabicDate(selectedClinic.subscriptionExpiresAt || '')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">الحالة الراهنة للعيادة:</span>
                    <span className={`font-bold ${isClinicExpired(selectedClinic.subscriptionExpiresAt) ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {getDaysRemainingText(selectedClinic.subscriptionExpiresAt)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Duration & Custom Period (7 Cols) */}
            <div className="lg:col-span-7 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  مدة التجديد وتمديد الاشتراك <span className="text-rose-500">*</span>
                </label>

                {/* Duration Mode Tabs */}
                <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setDurationMode('preset')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      durationMode === 'preset'
                        ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80'
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    <span>الباقات والشهور القياسية</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDurationMode('custom')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      durationMode === 'custom'
                        ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80'
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    <span>فترة مخصصة (أيام / شهور / تاريخ)</span>
                  </button>
                </div>
              </div>

              {/* Mode A: Preset Month Options */}
              {durationMode === 'preset' ? (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { months: 1, label: 'شهر واحد', badge: '1 شهر' },
                    { months: 3, label: '3 شهور', badge: 'ربع سنوي' },
                    { months: 6, label: '6 شهور', badge: 'نصف سنوي' },
                    { months: 12, label: '12 شهر', badge: 'سنة كاملة' },
                    { months: 24, label: '24 شهر', badge: 'سنتين' }
                  ].map((item) => (
                    <button
                      key={item.months}
                      type="button"
                      onClick={() => setPresetMonths(item.months)}
                      className={`p-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center justify-center gap-1 ${
                        presetMonths === item.months
                          ? 'border-indigo-600 bg-indigo-50/60 text-indigo-700 ring-2 ring-indigo-500/20 font-bold shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <span className="text-xs font-bold">{item.label}</span>
                      <span className="text-[10px] text-slate-400 font-normal">{item.badge}</span>
                    </button>
                  ))}
                </div>
              ) : (
                /* Mode B: Custom Duration Controls */
                <div className="p-3.5 bg-indigo-50/40 rounded-xl border border-indigo-100 space-y-3 animate-fade-in">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 ml-1">نوع الفترة المخصصة:</span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCustomType('days')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          customType === 'days'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        📅 بالأيام
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomType('months')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          customType === 'months'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        📆 بالشهور
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomType('exact_date')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          customType === 'exact_date'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        🗓️ تحديد تاريخ انتهاء معين
                      </button>
                    </div>
                  </div>

                  {/* Custom Type Specific Inputs */}
                  <div className="pt-1">
                    {customType === 'days' && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            عدد الأيام المراد إضافتها للاشتراك:
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              min={1}
                              max={3650}
                              value={customDays}
                              onChange={(e) => setCustomDays(Math.max(1, Number(e.target.value)))}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="30"
                            />
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">يوم</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-4">
                          {[7, 14, 21, 30, 45, 60, 90, 180].map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setCustomDays(d)}
                              className={`px-2.5 py-1 text-[11px] rounded-lg border font-medium cursor-pointer transition ${
                                customDays === d
                                  ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              +{d} يوم
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {customType === 'months' && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            عدد الشهور المراد إضافتها للاشتراك:
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              min={1}
                              max={120}
                              value={customMonths}
                              onChange={(e) => setCustomMonths(Math.max(1, Number(e.target.value)))}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="2"
                            />
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">شهر</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-4">
                          {[2, 4, 5, 8, 9, 15, 18, 36].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setCustomMonths(m)}
                              className={`px-2.5 py-1 text-[11px] rounded-lg border font-medium cursor-pointer transition ${
                                customMonths === m
                                  ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              +{m} شهور
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {customType === 'exact_date' && (
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          حدد تاريخ انتهاء الاشتراك الجديد مباشرة:
                        </label>
                        <input
                          type="date"
                          value={customExactDate}
                          onChange={(e) => setCustomExactDate(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Start Date Strategy Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs">
                <span className="font-bold text-slate-700 flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-indigo-600" />
                  بدء احتساب فترة التمديد من:
                </span>
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="startFrom"
                      checked={startFromOption === 'auto'}
                      onChange={() => setStartFromOption('auto')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>تمديد من نهاية الاشتراك الحالي (الموصى به)</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="startFrom"
                      checked={startFromOption === 'today'}
                      onChange={() => setStartFromOption('today')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>بدء التمديد من اليوم مباشرة</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Financial & Payment Details Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                المبلغ المالي المحصل (ج.م) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  required
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  placeholder="500"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-black text-center text-slate-900 bg-white"
                />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">ج.م</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                طريقة دفع الاشتراك <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm bg-white font-bold text-slate-800"
              >
                <option value="cash">💵 نقدي (كاش)</option>
                <option value="wallet">📱 محفظة إلكترونية (فودافون/اتصالات كاش)</option>
                <option value="instapay">⚡ إنستاباي (InstaPay)</option>
                <option value="card">💳 فيزا / بطاقة بنكية</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ملاحظات التحصيل والمعاملة
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: تحويل رقم محفظة 010... أو رقم إيصال"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs bg-white text-slate-800"
              />
            </div>
          </div>

          {/* 4. Live Calculation & Preview Summary Card */}
          <div className="p-4 bg-gradient-to-r from-indigo-50/80 via-blue-50/60 to-purple-50/80 rounded-2xl border border-indigo-100/90 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <span>معاينة نتيجة التجديد والتفعيل:</span>
              </div>
              <p className="text-xs text-indigo-950 font-medium">
                {selectedClinic ? (
                  <>
                    سيتم تجديد وتمديد اشتراك عيادة <strong className="text-indigo-700 font-bold">"{selectedClinic.name}"</strong> ليصبح تاريخ الانتهاء الجديد هو:
                  </>
                ) : (
                  'يرجى تحديد العيادة من القائمة أعلاه لمعاينة تفاصيل التجديد'
                )}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white px-4 py-2 rounded-xl border border-indigo-200 shadow-xs text-left">
                <div className="text-[10px] text-slate-400 font-bold">تاريخ الانتهاء الجديد</div>
                <div className="text-xs sm:text-sm font-black text-indigo-700 font-mono" dir="ltr">
                  {formatArabicDate(calculatedNewExpiry.toISOString())}
                </div>
              </div>
            </div>
          </div>

          {/* 5. Submit Actions */}
          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-5 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading || !selectedClinicId}
              className="px-6 py-2.5 text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl text-xs font-bold transition shadow-md shadow-indigo-200 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>جاري تسجيل التجديد...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>تأكيد التجديد وتحديث الاشتراك</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Filter and Summary Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="relative flex-1">
          <Search className="h-5 w-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ابحث عن تجديدات عيادة معينة بالاسم..."
            className="w-full pl-4 pr-11 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="px-3.5 py-1.5 bg-indigo-50/80 border border-indigo-200/60 rounded-xl flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-bold">عدد العمليات:</span>
            <span className="font-black text-indigo-700 font-mono">{filteredRenewals.length}</span>
          </div>
          <div className="px-3.5 py-1.5 bg-emerald-50/80 border border-emerald-200/60 rounded-xl flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-bold">إجمالي الاشتراكات:</span>
            <span className="font-black text-emerald-700 font-mono">
              {filteredRenewals.reduce((sum, r) => sum + (Number(r.amount) || 0), 0).toLocaleString()} ج.م
            </span>
          </div>
        </div>
      </div>

      {/* Renewals Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {loading && renewals.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCw className="h-8 w-8 text-indigo-600 animate-spin mx-auto mb-2" />
            <p className="text-sm font-bold">جاري تحميل المعاملات...</p>
          </div>
        ) : filteredRenewals.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-600">لا يوجد سجلات لتجديد الاشتراكات حالياً</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100/90 text-slate-700 text-xs font-black uppercase tracking-wider border-b border-slate-200">
                  <th className="p-4">اسم العيادة</th>
                  <th className="p-4">تاريخ التجديد</th>
                  <th className="p-4">الفترة (من - إلى)</th>
                  <th className="p-4">المبلغ المالي</th>
                  <th className="p-4">طريقة الدفع</th>
                  <th className="p-4">ملاحظات</th>
                  <th className="p-4 text-center">إجراءات الحذف والتراجع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredRenewals.map((r) => {
                  const methodStr = (r.paymentMethod || 'cash').toLowerCase();
                  const isCash = methodStr === 'cash' || methodStr.includes('كاش');
                  const isCard = methodStr === 'card' || methodStr.includes('فيزا');
                  const isInstapay = methodStr === 'instapay' || methodStr.includes('انستا');
                  const isWallet = methodStr === 'wallet' || methodStr.includes('محفظ');

                  return (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition">
                      <td className="p-4 font-bold text-slate-800">{r.clinicName}</td>
                      <td className="p-4 font-mono text-xs text-slate-600" dir="ltr">
                        {formatArabicDate(r.renewedAt)}
                      </td>
                      <td className="p-4 space-y-1">
                        <div className="text-xs text-slate-500">
                          <span className="font-bold">قبل:</span> <span className="font-mono">{formatArabicDate(r.oldExpiry)}</span>
                        </div>
                        <div className="text-xs text-indigo-700 font-bold">
                          <span>بعد:</span> <span className="font-mono">{formatArabicDate(r.newExpiry)}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full text-xs font-extrabold">
                          {r.amount.toLocaleString()} ج.م
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                          isCash ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' :
                          isCard ? 'bg-blue-50 text-blue-700 border border-blue-200/60' :
                          isInstapay ? 'bg-purple-50 text-purple-700 border border-purple-200/60' :
                          'bg-amber-50 text-amber-700 border border-amber-200/60'
                        }`}>
                          {isCash ? '💵 كاش' : isCard ? '💳 فيزا' : isInstapay ? '⚡ إنستاباي' : '📱 محفظة'}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-slate-500 max-w-xs truncate" title={r.notes}>
                        {r.notes || '—'}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteRenewal(r)}
                          disabled={deletingId === r.id || loading}
                          className="px-3 py-1.5 text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 rounded-xl transition shadow-2xs cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 text-xs font-bold"
                          title={`حذف تجديد ${r.clinicName} واسترجاع تاريخ الاشتراك السابق`}
                        >
                          {deletingId === r.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-rose-600" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          )}
                          <span>حذف وتراجع</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
