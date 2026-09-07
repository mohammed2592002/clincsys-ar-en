import React from 'react';
import { useClinic, ActiveTab } from '../context/ClinicContext';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Stethoscope,
  Pill,
  Receipt,
  TestTube,
  Activity,
  Plus
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    language,
    appointments,
    drugs,
    patients,
    setSelectedPatientId
  } = useClinic();

  const isAr = language === 'ar';

  const waitingAppointmentsCount = appointments.filter(
    (a) => a.status === 'Waiting' || a.status === 'In Progress'
  ).length;

  const lowStockDrugsCount = drugs.filter(
    (d) => d.stockQuantity <= d.minStockLevel
  ).length;

  const navItems: { id: ActiveTab; labelAr: string; labelEn: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'dashboard',
      labelAr: 'لوحة التحكم',
      labelEn: 'Dashboard',
      icon: <LayoutDashboard className="w-5 h-5" />
    },
    {
      id: 'appointments',
      labelAr: 'المواعيد والانتظار',
      labelEn: 'Appointments & Queue',
      icon: <CalendarDays className="w-5 h-5" />,
      badge: waitingAppointmentsCount > 0 ? waitingAppointmentsCount : undefined
    },
    {
      id: 'consultation',
      labelAr: 'الكشف الطبي والروشتة',
      labelEn: 'Examination & EHR',
      icon: <Stethoscope className="w-5 h-5" />
    },
    {
      id: 'patients',
      labelAr: 'سجلات المرضى',
      labelEn: 'Patient Directory',
      icon: <Users className="w-5 h-5" />,
      badge: patients.length
    },
    {
      id: 'pharmacy',
      labelAr: 'الصيدلية والمخزون',
      labelEn: 'Pharmacy & Stock',
      icon: <Pill className="w-5 h-5" />,
      badge: lowStockDrugsCount > 0 ? lowStockDrugsCount : undefined
    },
    {
      id: 'billing',
      labelAr: 'الفواتير والحسابات',
      labelEn: 'Billing & Invoices',
      icon: <Receipt className="w-5 h-5" />
    },
    {
      id: 'labs',
      labelAr: 'المختبر والتحاليل',
      labelEn: 'Laboratory & Labs',
      icon: <TestTube className="w-5 h-5" />
    }
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 min-h-screen border-e border-slate-800 transition-all">
      {/* Clinic Logo & Brand */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center text-white shadow-md shadow-teal-900/30">
          <Activity className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-bold text-base text-white tracking-tight">
            {isAr ? 'نظام العيادة الشامل' : 'MediCare Clinic'}
          </h1>
          <p className="text-[11px] text-teal-400 font-medium">
            {isAr ? 'إدارة العيادات والمستوصفات' : 'Clinic Management System'}
          </p>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
        <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          {isAr ? 'القائمة الرئيسية' : 'Main Menu'}
        </div>

        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-teal-600 text-white font-semibold shadow-sm shadow-teal-900/40'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={isActive ? 'text-white' : 'text-slate-400'}>
                  {item.icon}
                </span>
                <span>{isAr ? item.labelAr : item.labelEn}</span>
              </div>
              {item.badge !== undefined && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    isActive
                      ? 'bg-white text-teal-700'
                      : item.id === 'pharmacy' && lowStockDrugsCount > 0
                      ? 'bg-amber-500 text-slate-950 animate-pulse'
                      : 'bg-teal-900/80 text-teal-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Quick Action Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/50">
        <button
          onClick={() => {
            setSelectedPatientId(null);
            setActiveTab('patients');
          }}
          className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-teal-300 hover:text-white rounded-xl text-xs font-semibold border border-slate-700/80 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4 text-teal-400" />
          <span>{isAr ? 'تسجيل مريض جديد' : 'Register New Patient'}</span>
        </button>
      </div>
    </aside>
  );
};
