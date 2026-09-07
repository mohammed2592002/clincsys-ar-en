import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Receipt, 
  Download, 
  Search, 
  CreditCard, 
  Wallet, 
  Calendar, 
  Building2, 
  DollarSign, 
  CheckCircle, 
  RefreshCw,
  Coins
} from 'lucide-react';
import { useDialogs } from '../DialogContext';

interface IncomeStatsTabProps {}

export default function IncomeStatsTab({}: IncomeStatsTabProps) {
  const dialogs = useDialogs();

  const [incomePeriod, setIncomePeriod] = useState<'daily' | 'weekly' | 'monthly' | 'custom' | 'all'>('daily');
  const [incomeTargetDate, setIncomeTargetDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [incomeStartDate, setIncomeStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [incomeEndDate, setIncomeEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [incomeSearchQuery, setIncomeSearchQuery] = useState<string>('');
  const [incomeLoading, setIncomeLoading] = useState<boolean>(false);

  const [incomeStatsData, setIncomeStatsData] = useState<{
    summary: {
      totalIncome: number;
      totalTransactions: number;
      cashTotal: number;
      cardTotal: number;
      instapayTotal: number;
      walletTotal: number;
      activeClinicsCount: number;
    };
    clinicIncomeList: Array<{
      clinicId: string;
      clinicName: string;
      doctorName: string;
      isActive: boolean;
      totalIncome: number;
      totalTransactions: number;
      cash: number;
      card: number;
      instapay: number;
      wallet: number;
    }>;
    recentTransactions: Array<{
      id: string;
      clinicName: string;
      patientName: string;
      amount: number;
      method: string;
      date: string;
    }>;
  } | null>(null);

  const fetchIncomeStats = async () => {
    setIncomeLoading(true);
    try {
      let url = `/api/superadmin/income-stats?period=${incomePeriod}&date=${incomeTargetDate}`;
      if (incomePeriod === 'custom') {
        url += `&startDate=${incomeStartDate}&endDate=${incomeEndDate}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setIncomeStatsData(data);
      }
    } catch (err) {
      console.error('Error fetching admin income stats:', err);
    } finally {
      setIncomeLoading(false);
    }
  };

  useEffect(() => {
    fetchIncomeStats();
  }, [incomePeriod, incomeTargetDate, incomeStartDate, incomeEndDate]);

  const handleExportIncomeStats = () => {
    if (!incomeStatsData) {
      dialogs.alert('لا توجد إحصائيات متوفرة للتصدير حالياً.', { severity: 'warning' });
      return;
    }
    const csvRows = [
      ['العيادة', 'الطبيب', 'إجمالي الإيراد', 'عدد العمليات', 'كاش', 'فيزا', 'إنستاباي', 'محفظة'].join(','),
      ...incomeStatsData.clinicIncomeList.map(c => [
        `"${c.clinicName || ''}"`,
        `"${c.doctorName || ''}"`,
        c.totalIncome || 0,
        c.totalTransactions || 0,
        c.cash || 0,
        c.card || 0,
        c.instapay || 0,
        c.wallet || 0
      ].join(','))
    ];
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `income_stats_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredClinicIncome = (incomeStatsData?.clinicIncomeList || []).filter(c => {
    if (!incomeSearchQuery.trim()) return true;
    const q = incomeSearchQuery.toLowerCase();
    return (c.clinicName || '').toLowerCase().includes(q) || (c.doctorName || '').toLowerCase().includes(q);
  });

  const summary = incomeStatsData?.summary || {
    totalIncome: 0,
    totalTransactions: 0,
    cashTotal: 0,
    cardTotal: 0,
    instapayTotal: 0,
    walletTotal: 0,
    activeClinicsCount: 0
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header & Export */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-600" />
            إحصائيات الإيرادات وتجديدات المنظومة
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            متابعة عوائد اشتراكات المنظومة، توزيع طرق الدفع (كاش / فيزا / إنستاباي / محفظة) وتقارير الأداء
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchIncomeStats}
            disabled={incomeLoading}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition cursor-pointer"
            title="تحديث البيانات"
          >
            <RefreshCw className={`h-4 w-4 ${incomeLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleExportIncomeStats}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl shadow-md transition cursor-pointer text-xs"
          >
            <Download className="h-4 w-4" />
            تصدير تقرير Excel (CSV)
          </button>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        {/* Period Selector */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          {(['daily', 'weekly', 'monthly', 'all', 'custom'] as const).map((period) => (
            <button
              key={period}
              onClick={() => setIncomePeriod(period)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                incomePeriod === period
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {period === 'daily' && 'اليوم'}
              {period === 'weekly' && 'هذا الأسبوع'}
              {period === 'monthly' && 'هذا الشهر'}
              {period === 'all' && 'إجمالي الكل'}
              {period === 'custom' && 'فترة مخصصة'}
            </button>
          ))}
        </div>

        {/* Date Inputs */}
        {incomePeriod === 'daily' && (
          <input
            type="date"
            value={incomeTargetDate}
            onChange={(e) => setIncomeTargetDate(e.target.value)}
            className="p-2 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 font-mono"
          />
        )}

        {incomePeriod === 'custom' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-bold">من:</span>
            <input
              type="date"
              value={incomeStartDate}
              onChange={(e) => setIncomeStartDate(e.target.value)}
              className="p-2 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 font-mono"
            />
            <span className="text-xs text-slate-500 font-bold">إلى:</span>
            <input
              type="date"
              value={incomeEndDate}
              onChange={(e) => setIncomeEndDate(e.target.value)}
              className="p-2 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 font-mono"
            />
          </div>
        )}
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>إجمالي الإيرادات</span>
            <Coins className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {summary.totalIncome.toLocaleString()} <span className="text-xs text-slate-500 font-normal">ج.م</span>
          </div>
          <div className="text-[11px] text-emerald-600 font-bold">
            {summary.totalTransactions} عملية دفع مسجلة
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>نقداً (كاش)</span>
            <DollarSign className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="text-xl font-bold text-slate-800 font-mono">
            {summary.cashTotal.toLocaleString()} <span className="text-xs text-slate-500 font-normal">ج.م</span>
          </div>
          <div className="text-[11px] text-slate-400">
            {summary.totalIncome > 0 ? Math.round((summary.cashTotal / summary.totalIncome) * 100) : 0}% من الإجمالي
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>إنستاباي (InstaPay)</span>
            <TrendingUp className="h-5 w-5 text-purple-600" />
          </div>
          <div className="text-xl font-bold text-slate-800 font-mono">
            {summary.instapayTotal.toLocaleString()} <span className="text-xs text-slate-500 font-normal">ج.م</span>
          </div>
          <div className="text-[11px] text-purple-600 font-bold">
            تحويل بنكي فوري
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>محفظة / فيزا</span>
            <CreditCard className="h-5 w-5 text-amber-600" />
          </div>
          <div className="text-xl font-bold text-slate-800 font-mono">
            {(summary.walletTotal + summary.cardTotal).toLocaleString()} <span className="text-xs text-slate-500 font-normal">ج.م</span>
          </div>
          <div className="text-[11px] text-amber-600 font-bold">
            محافظ إلكترونية وبطاقات
          </div>
        </div>
      </div>

      {/* Breakdown by Clinic Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-600" />
            تفصيل إيرادات الاشتراكات بحسب العيادة
          </h3>

          <div className="relative min-w-[220px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={incomeSearchQuery}
              onChange={(e) => setIncomeSearchQuery(e.target.value)}
              placeholder="بحث باسم العيادة..."
              className="w-full pl-3 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="p-3">العيادة</th>
                <th className="p-3">الطبيب</th>
                <th className="p-3">عدد العمليات</th>
                <th className="p-3">كاش</th>
                <th className="p-3">إنستاباي</th>
                <th className="p-3">محفظة / فيزا</th>
                <th className="p-3 font-extrabold text-emerald-800">إجمالي المسدد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClinicIncome.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">
                    لا توجد إيرادات مسجلة لهذه الفترة.
                  </td>
                </tr>
              ) : (
                filteredClinicIncome.map((c) => (
                  <tr key={c.clinicId} className="hover:bg-slate-50 transition">
                    <td className="p-3 font-bold text-slate-800">{c.clinicName}</td>
                    <td className="p-3 text-slate-500">{c.doctorName || 'غير محدد'}</td>
                    <td className="p-3 font-mono">{c.totalTransactions}</td>
                    <td className="p-3 font-mono text-slate-700">{c.cash.toLocaleString()} ج.م</td>
                    <td className="p-3 font-mono text-purple-700">{c.instapay.toLocaleString()} ج.م</td>
                    <td className="p-3 font-mono text-amber-700">{(c.wallet + c.card).toLocaleString()} ج.م</td>
                    <td className="p-3 font-mono font-bold text-emerald-600 text-sm">
                      {c.totalIncome.toLocaleString()} ج.م
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
