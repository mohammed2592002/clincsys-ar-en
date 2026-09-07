import React, { useState, useEffect } from 'react';
import { db, doc, collection, getDocsSmart as getDocs, getDocSmart, setDoc } from '../dbClient';
import { Clinic, SupportSettings, DEFAULT_SUPPORT_SETTINGS } from '../types';
import { useDialogs } from './DialogContext';
import AdminRenewals from './AdminRenewals';
import ClinicsTab from './superadmin/ClinicsTab';
import IncomeStatsTab from './superadmin/IncomeStatsTab';
import SystemBackupTab from './superadmin/SystemBackupTab';
import AdminSecurityTab from './superadmin/AdminSecurityTab';
import TechSupportTab from './superadmin/TechSupportTab';
import { 
  LogOut, 
  Building2, 
  Receipt, 
  TrendingUp, 
  Database, 
  KeyRound, 
  Headphones, 
  Megaphone, 
  RefreshCw, 
  Users, 
  Calendar, 
  DollarSign, 
  Sparkles, 
  Send, 
  CheckCircle,
  Activity,
  ShieldCheck,
  Palette,
  Eye,
  Trash2,
  SlidersHorizontal,
  Check
} from 'lucide-react';

const SUPERADMIN_HEADER_COLOR_PRESETS = [
  { name: 'الرمادي الداكن الأصلي', bg: '#0f172a', text: '#ffffff' },
  { name: 'الأزرق الليلي الفاخر', bg: '#0a192f', text: '#ffffff' },
  { name: 'الكحلي الملكي (Royal Navy)', bg: '#1e1b4b', text: '#ffffff' },
  { name: 'الزمردي الداكن (Emerald Slate)', bg: '#064e3b', text: '#ffffff' },
  { name: 'الأخضر التيل الطبي (Teal Slate)', bg: '#134e4a', text: '#ffffff' },
  { name: 'الأزرق المحيطي (Ocean Blue)', bg: '#0c4a6e', text: '#ffffff' },
  { name: 'البنفسجي الملكي (Deep Violet)', bg: '#3b0764', text: '#ffffff' },
  { name: 'العنابي الداكن (Dark Crimson)', bg: '#4c0519', text: '#ffffff' },
  { name: 'البرونزي النحاسي (Deep Bronze)', bg: '#451a03', text: '#ffffff' },
  { name: 'الأسود الفحمي (Obsidian Pure)', bg: '#000000', text: '#ffffff' },
  { name: 'الأبيض الناصع الحديث', bg: '#ffffff', text: '#0f172a' },
  { name: 'الرمادي الفضي المودرن', bg: '#f1f5f9', text: '#0f172a' },
  { name: 'الأزرق الفاتح الجليدي', bg: '#e0f2fe', text: '#0369a1' }
];

const BG_COLOR_PRESETS = [
  { name: 'زمردي رسمي', hex: '#059669' },
  { name: 'كحلي إنديجو', hex: '#4338ca' },
  { name: 'كهرماني تحذيري', hex: '#d97706' },
  { name: 'أحمر عاجل', hex: '#dc2626' },
  { name: 'بنفسجي ملكي', hex: '#7c3aed' },
  { name: 'سماوي بحري', hex: '#0284c7' },
  { name: 'رمادي داكن', hex: '#0f172a' },
  { name: 'وردي توتي', hex: '#be185d' },
  { name: 'أصفر فاتح', hex: '#fef3c7' },
  { name: 'سماوي ناعم', hex: '#e0f2fe' }
];

const TEXT_COLOR_PRESETS = [
  { name: 'أبيض ناصع', hex: '#ffffff' },
  { name: 'أسود داكن', hex: '#0f172a' },
  { name: 'ذهبي أصفر', hex: '#fef08a' },
  { name: 'أخضر نعناعي', hex: '#a7f3d0' },
  { name: 'سماوي فاتح', hex: '#bae6fd' },
  { name: 'بني كهرماني', hex: '#92400e' },
  { name: 'أزرق كحلي', hex: '#0369a1' }
];

const QUICK_THEMES = [
  { label: 'إشعار رسمي', bg: '#059669', text: '#ffffff' },
  { label: 'تحديث نظام', bg: '#4338ca', text: '#ffffff' },
  { label: 'تنبيه عاجل', bg: '#dc2626', text: '#ffffff' },
  { label: 'تنبيه صيانة', bg: '#fef3c7', text: '#92400e' },
  { label: 'إعلان ذهبي داكن', bg: '#0f172a', text: '#fef08a' },
  { label: 'إشعار أزرق هادئ', bg: '#e0f2fe', text: '#0369a1' }
];

interface SuperAdminDashboardProps {
  saveSession: (session: { type: 'clinic'; clinicId: string; clinicName: string } | { type: 'admin' } | { type: 'logged_out' }) => void;
  handleLogout: () => void;
}

export default function SuperAdminDashboard({ saveSession, handleLogout }: SuperAdminDashboardProps) {
  const dialogs = useDialogs();

  // Active Tab
  const [adminActiveTab, setAdminActiveTab] = useState<
    'clinics' | 'renewals' | 'income_stats' | 'system_backup' | 'admin_security' | 'tech_support'
  >('clinics');

  // Clinics List
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);

  // Global Analytics State
  const [globalStats, setGlobalStats] = useState<{
    totalClinics: number;
    activeClinics: number;
    inactiveClinics: number;
    totalPatients: number;
    todayAppointments?: number;
    todayPrescriptions?: number;
    todayRevenuesSum: number;
    todayRevenuesCount: number;
    totalSubscriptionsIncome?: number;
    totalRenewalsCount?: number;
  } | null>(null);

  const [clinicUsage, setClinicUsage] = useState<Array<{
    id: string;
    name: string;
    doctorName: string;
    isActive: boolean;
    numPatients: number;
    numAppointments: number;
    numShifts: number;
    createdAt?: string;
  }>>([]);

  // Broadcast Message State
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastBgColor, setBroadcastBgColor] = useState('#059669');
  const [broadcastTextColor, setBroadcastTextColor] = useState('#ffffff');
  const [showColorCustomizer, setShowColorCustomizer] = useState(false);
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [activeBroadcast, setActiveBroadcast] = useState<{ id: string; content: string; bgColor?: string; textColor?: string; isActive: boolean } | null>(null);

  // SuperAdmin Header Color State
  const [headerBgColor, setHeaderBgColor] = useState<string>(() => {
    return localStorage.getItem('crowndent_superadmin_header_bg') || '#0f172a';
  });
  const [headerTextColor, setHeaderTextColor] = useState<string>(() => {
    return localStorage.getItem('crowndent_superadmin_header_text') || '#ffffff';
  });
  const [showHeaderColorMenu, setShowHeaderColorMenu] = useState(false);
  const [isSavingHeaderColor, setIsSavingHeaderColor] = useState(false);

  // Apply & Save Header Color
  const handleUpdateHeaderColor = async (bg: string, text: string = '#ffffff') => {
    setHeaderBgColor(bg);
    setHeaderTextColor(text);
    try {
      localStorage.setItem('crowndent_superadmin_header_bg', bg);
      localStorage.setItem('crowndent_superadmin_header_text', text);
    } catch (e) {}

    // Also persist in supportSettings
    setSupportSettings(prev => ({
      ...prev,
      superAdminHeaderBg: bg,
      superAdminHeaderTextColor: text
    }));

    try {
      setIsSavingHeaderColor(true);
      const docRef = doc(db, 'system_settings', 'support');
      await setDoc(docRef, {
        ...supportSettings,
        superAdminHeaderBg: bg,
        superAdminHeaderTextColor: text,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.warn('Failed to save header color to cloud settings:', err);
    } finally {
      setIsSavingHeaderColor(false);
    }
  };

  // Tech Support Settings State
  const [supportSettings, setSupportSettings] = useState<SupportSettings>(DEFAULT_SUPPORT_SETTINGS);
  const [isSavingSupport, setIsSavingSupport] = useState(false);
  const [isLoadingSupport, setIsLoadingSupport] = useState(false);

  // Fetch Clinics
  const fetchClinics = async () => {
    setAdminLoading(true);
    try {
      const snap = await getDocs(collection(db, 'clinics'), true);
      const list: Clinic[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name || '',
          nameAr: data.nameAr || '',
          nameEn: data.nameEn || '',
          logoUrl: data.logoUrl || '',
          doctorName: data.doctorName || '',
          doctorPhone: data.doctorPhone || '',
          address: data.address || '',
          prescriptionStyle: data.prescriptionStyle || 'classic',
          email: data.email || '',
          password: data.password || '',
          createdAt: data.createdAt || '',
          isActive: data.isActive !== false,
          subscriptionExpiresAt: data.subscriptionExpiresAt || '',
          staffPin: data.staffPin || '1234',
          staffMembers: data.staffMembers || [],
          allowedFeatures: data.allowedFeatures || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials']
        });
      });
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setClinics(list);
    } catch (err) {
      console.error('Error fetching clinics:', err);
    } finally {
      setAdminLoading(false);
    }
  };

  // Fetch Analytics & Active Broadcast
  const fetchAnalyticsAndBroadcast = async () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const res = await fetch(`/api/superadmin/analytics?today=${todayStr}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.globalStats) {
          setGlobalStats(data.globalStats);
          setClinicUsage(data.clinicUsage || []);
          return;
        }
      }
    } catch (err) {
      // In local/offline or sandboxed preview modes where the backend route might be unavailable, calculate fallback stats gracefully from client DB
      console.warn('SuperAdmin analytics endpoint fallback to local stats:', err);
    }

    // Fallback calculation directly from loaded clinics & client db
    try {
      const snap = await getDocs(collection(db, 'clinics'));
      let activeCount = 0;
      let inactiveCount = 0;
      const list: Array<{
        id: string;
        name: string;
        doctorName: string;
        isActive: boolean;
        numPatients: number;
        numAppointments: number;
        numShifts: number;
        createdAt?: string;
      }> = [];

      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const isActive = d.isActive !== false;
        if (isActive) activeCount++;
        else inactiveCount++;

        list.push({
          id: docSnap.id,
          name: d.name || 'عيادة بدون اسم',
          doctorName: d.doctorName || 'غير محدد',
          isActive,
          numPatients: 0,
          numAppointments: 0,
          numShifts: 0,
          createdAt: d.createdAt || ''
        });
      });

      // Also calculate total subscription renewals if available
      let renewalsTotal = 0;
      let renewalsCount = 0;
      try {
        const rSnap = await getDocs(collection(db, 'renewals'));
        rSnap.forEach((rDoc) => {
          const rData = rDoc.data();
          const amt = Number(rData.amount || 0);
          if (amt > 0) {
            renewalsTotal += amt;
            renewalsCount++;
          }
        });
      } catch (e) {}

      setGlobalStats(prev => ({
        totalClinics: snap.docs.length,
        activeClinics: activeCount,
        inactiveClinics: inactiveCount,
        totalPatients: prev?.totalPatients || 0,
        todayAppointments: prev?.todayAppointments || 0,
        todayPrescriptions: prev?.todayPrescriptions || 0,
        todayRevenuesSum: prev?.todayRevenuesSum || 0,
        todayRevenuesCount: prev?.todayRevenuesCount || 0,
        totalSubscriptionsIncome: renewalsTotal,
        totalRenewalsCount: renewalsCount
      }));
      setClinicUsage(list);
    } catch (fallbackErr) {
      console.error('Error computing fallback admin analytics:', fallbackErr);
    }

    try {
      const bRes = await fetch('/api/broadcasts/active');
      if (bRes.ok) {
        const bData = await bRes.json();
        setActiveBroadcast(bData);
        if (bData) {
          setBroadcastMessage(bData.content || '');
          setBroadcastBgColor(bData.bgColor || '#059669');
          setBroadcastTextColor(bData.textColor || '#ffffff');
        } else {
          setBroadcastMessage('');
        }
      }
    } catch (err) {
      console.warn('Error fetching active broadcast:', err);
    }
  };

  // Load Support Settings
  const loadSupportData = async () => {
    setIsLoadingSupport(true);
    try {
      const docRef = doc(db, 'system_settings', 'support');
      const snap = await getDocSmart(docRef);
      if (snap && snap.exists() && snap.data()) {
        const d = snap.data();
        setSupportSettings({
          trialPhoneNumber: d.trialPhoneNumber || DEFAULT_SUPPORT_SETTINGS.trialPhoneNumber || '01012345678',
          superAdminHeaderBg: d.superAdminHeaderBg || DEFAULT_SUPPORT_SETTINGS.superAdminHeaderBg || '#0f172a',
          superAdminHeaderTextColor: d.superAdminHeaderTextColor || DEFAULT_SUPPORT_SETTINGS.superAdminHeaderTextColor || '#ffffff',
          phoneNumbers: Array.isArray(d.phoneNumbers) ? d.phoneNumbers : DEFAULT_SUPPORT_SETTINGS.phoneNumbers,
          socialLinks: Array.isArray(d.socialLinks) ? d.socialLinks : DEFAULT_SUPPORT_SETTINGS.socialLinks,
          workingHoursNotice: d.workingHoursNotice || DEFAULT_SUPPORT_SETTINGS.workingHoursNotice,
          defaultSystemLogoUrl: d.defaultSystemLogoUrl || ''
        });

        if (d.superAdminHeaderBg) {
          setHeaderBgColor(d.superAdminHeaderBg);
          try {
            localStorage.setItem('crowndent_superadmin_header_bg', d.superAdminHeaderBg);
          } catch (e) {}
        }
        if (d.superAdminHeaderTextColor) {
          setHeaderTextColor(d.superAdminHeaderTextColor);
          try {
            localStorage.setItem('crowndent_superadmin_header_text', d.superAdminHeaderTextColor);
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('Error loading support settings:', err);
    } finally {
      setIsLoadingSupport(false);
    }
  };

  // Save Support Settings
  const handleSaveSupportSettings = async () => {
    if (supportSettings.phoneNumbers.length > 10) {
      dialogs.alert('عفواً، لا يمكن إضافة أكثر من 10 أرقام دعم فني.', { severity: 'warning' });
      return;
    }

    setIsSavingSupport(true);
    try {
      const docRef = doc(db, 'system_settings', 'support');
      await setDoc(docRef, {
        ...supportSettings,
        updatedAt: new Date().toISOString()
      });
      dialogs.alert('تم حفظ وتحديث إعدادات الدعم الفني وهوية المنظومة بنجاح!', { severity: 'success' });
    } catch (err: any) {
      console.error('Error saving support settings:', err);
      dialogs.alert('حدث خطأ أثناء حفظ الإعدادات: ' + err.toString(), { severity: 'error' });
    } finally {
      setIsSavingSupport(false);
    }
  };

  // Save Broadcast
  const handleSaveBroadcast = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setBroadcastLoading(true);
    try {
      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content: broadcastMessage,
          bgColor: broadcastBgColor,
          textColor: broadcastTextColor
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.cleared) {
          setActiveBroadcast(null);
          setBroadcastMessage('');
          dialogs.alert('تم إيقاف الإعلان الموحد ونقله للأرشيف.', { severity: 'success' });
        } else {
          setActiveBroadcast(data);
          dialogs.alert('تم نشر الإعلان الموحد وتعميمه بنجاح بالألوان المحددة على كافة الأجهزة النشطة بالمنصة!', { severity: 'success' });
        }
        await fetchAnalyticsAndBroadcast();
      } else {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      dialogs.alert('فشل حفظ الإعلان: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setBroadcastLoading(false);
    }
  };

  // Clear Broadcast
  const handleClearBroadcast = async () => {
    const confirmed = await dialogs.confirm('هل أنت متأكد من رغبتك في إيقاف ومسح التنويه المعمم حالياً؟');
    if (!confirmed) return;

    setBroadcastLoading(true);
    try {
      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' })
      });
      if (res.ok) {
        setActiveBroadcast(null);
        setBroadcastMessage('');
        dialogs.alert('تم مسح وإلغاء التنويه النشط بنجاح.', { severity: 'success' });
        await fetchAnalyticsAndBroadcast();
      } else {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      dialogs.alert('فشل مسح الإعلان: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setBroadcastLoading(false);
    }
  };

  useEffect(() => {
    fetchClinics();
    fetchAnalyticsAndBroadcast();
    loadSupportData();

    const interval = setInterval(() => {
      fetchClinics();
      fetchAnalyticsAndBroadcast();
    }, 15000);

    const handleSync = () => {
      fetchClinics();
      fetchAnalyticsAndBroadcast();
    };
    window.addEventListener('clinic-sync', handleSync);

    return () => {
      clearInterval(interval);
      window.removeEventListener('clinic-sync', handleSync);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-16" dir="rtl">
      {/* Top Navbar */}
      <header 
        style={{ 
          backgroundColor: headerBgColor, 
          color: headerTextColor,
          borderColor: 'rgba(255, 255, 255, 0.12)'
        }}
        className="shadow-lg sticky top-0 z-40 border-b transition-colors duration-200"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & Brand */}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-md">
                <ShieldCheck className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-base font-extrabold tracking-tight" style={{ color: headerTextColor }}>
                  CrownDent SuperAdmin
                </h1>
                <p className="text-[11px] font-medium opacity-90" style={{ color: headerTextColor === '#ffffff' ? '#34d399' : undefined }}>
                  لوحة التحكم والسيطرة الرئيسية للمنظومة
                </p>
              </div>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Header Color Palette Button & Menu */}
              <div className="relative">
                <button
                  id="btn-superadmin-header-color"
                  onClick={() => setShowHeaderColorMenu(!showHeaderColorMenu)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border"
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.12)',
                    color: headerTextColor,
                    borderColor: 'rgba(255, 255, 255, 0.2)'
                  }}
                  title="تغيير لون البار العلوي"
                >
                  <Palette className="h-4 w-4" />
                  <span className="hidden md:inline">لون البار</span>
                  <div 
                    className="w-3 h-3 rounded-full border border-white/40 shadow-inner" 
                    style={{ backgroundColor: headerBgColor }} 
                  />
                </button>

                {/* Color Selector Dropdown */}
                {showHeaderColorMenu && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowHeaderColorMenu(false)}
                    />
                    <div 
                      className="absolute left-0 mt-2 w-72 bg-white text-slate-800 rounded-2xl shadow-2xl border border-slate-200 z-50 p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
                      dir="rtl"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2 font-bold text-xs text-slate-800">
                          <Palette className="h-4 w-4 text-emerald-600" />
                          <span>تخصيص لون البار العلوي</span>
                        </div>
                        {isSavingHeaderColor && (
                          <span className="text-[10px] text-emerald-600 flex items-center gap-1 font-mono">
                            <RefreshCw className="h-3 w-3 animate-spin" /> جاري الحفظ...
                          </span>
                        )}
                      </div>

                      {/* Preset Swatches */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 block">ألوان مسبقة التجهيز:</label>
                        <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                          {SUPERADMIN_HEADER_COLOR_PRESETS.map((preset, idx) => {
                            const isSelected = headerBgColor.toLowerCase() === preset.bg.toLowerCase();
                            return (
                              <button
                                key={idx}
                                onClick={() => {
                                  handleUpdateHeaderColor(preset.bg, preset.text);
                                }}
                                className={`flex items-center gap-2 p-1.5 rounded-xl border text-right transition cursor-pointer text-xs ${
                                  isSelected 
                                    ? 'border-emerald-500 bg-emerald-50/60 font-bold ring-1 ring-emerald-500' 
                                    : 'border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <div 
                                  className="w-4 h-4 rounded-lg border border-black/10 shrink-0 shadow-xs" 
                                  style={{ backgroundColor: preset.bg }}
                                />
                                <span className="truncate text-[11px] text-slate-700">{preset.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Custom Color Pickers */}
                      <div className="pt-2 border-t border-slate-100 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <label className="font-bold text-slate-600 text-[11px]">لون مخصص للخلفية:</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={headerBgColor}
                              onChange={(e) => handleUpdateHeaderColor(e.target.value, headerTextColor)}
                              className="w-7 h-7 rounded-lg cursor-pointer border border-slate-300 p-0"
                            />
                            <span className="font-mono text-[10px] text-slate-500">{headerBgColor}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <label className="font-bold text-slate-600 text-[11px]">لون نصوص البار:</label>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleUpdateHeaderColor(headerBgColor, '#ffffff')}
                              className={`px-2 py-1 rounded-md text-[10px] font-bold border ${headerTextColor === '#ffffff' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}
                            >
                              أبيض
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateHeaderColor(headerBgColor, '#0f172a')}
                              className={`px-2 py-1 rounded-md text-[10px] font-bold border ${headerTextColor === '#0f172a' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}
                            >
                              داكن
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Quick Reset */}
                      <div className="pt-1 border-t border-slate-100 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            handleUpdateHeaderColor('#0f172a', '#ffffff');
                          }}
                          className="text-[11px] text-slate-500 hover:text-slate-800 transition cursor-pointer font-bold"
                        >
                          استعادة اللون الافتراضي
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowHeaderColorMenu(false)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-lg transition"
                        >
                          إغلاق
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => {
                  fetchClinics();
                  fetchAnalyticsAndBroadcast();
                }}
                disabled={adminLoading}
                className="p-2 rounded-xl transition cursor-pointer border"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: headerTextColor,
                  borderColor: 'rgba(255, 255, 255, 0.15)'
                }}
                title="تحديث البيانات"
              >
                <RefreshCw className={`h-4 w-4 ${adminLoading ? 'animate-spin' : ''}`} />
              </button>

              <button
                id="btn-superadmin-logout"
                onClick={handleLogout}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 bg-rose-600/90 hover:bg-rose-700 active:bg-rose-800 text-white text-xs font-bold rounded-xl shadow transition cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </div>

          {/* Navigation Tabs Bar */}
          <div 
            className="flex items-center gap-2 overflow-x-auto py-2.5 text-xs font-bold"
            style={{ borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}
          >
            <button
              onClick={() => setAdminActiveTab('clinics')}
              className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                adminActiveTab === 'clinics'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'hover:bg-white/10'
              }`}
              style={{
                color: adminActiveTab === 'clinics' ? '#ffffff' : headerTextColor,
                opacity: adminActiveTab === 'clinics' ? 1 : 0.82
              }}
            >
              <Building2 className="h-4 w-4" />
              العيادات المشتركة
              <span 
                className={`px-2 py-0.5 rounded-full text-[10px] ${
                  adminActiveTab === 'clinics' ? 'bg-emerald-700 text-white' : 'bg-black/20'
                }`}
                style={{ color: adminActiveTab === 'clinics' ? '#ffffff' : headerTextColor }}
              >
                {clinics.length}
              </span>
            </button>

            <button
              onClick={() => setAdminActiveTab('renewals')}
              className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                adminActiveTab === 'renewals'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'hover:bg-white/10'
              }`}
              style={{
                color: adminActiveTab === 'renewals' ? '#ffffff' : headerTextColor,
                opacity: adminActiveTab === 'renewals' ? 1 : 0.82
              }}
            >
              <Receipt className="h-4 w-4" />
              سجل التجديدات
            </button>

            <button
              onClick={() => setAdminActiveTab('income_stats')}
              className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                adminActiveTab === 'income_stats'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'hover:bg-white/10'
              }`}
              style={{
                color: adminActiveTab === 'income_stats' ? '#ffffff' : headerTextColor,
                opacity: adminActiveTab === 'income_stats' ? 1 : 0.82
              }}
            >
              <TrendingUp className="h-4 w-4" />
              الإيرادات والماليات
            </button>

            <button
              onClick={() => setAdminActiveTab('system_backup')}
              className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                adminActiveTab === 'system_backup'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'hover:bg-white/10'
              }`}
              style={{
                color: adminActiveTab === 'system_backup' ? '#ffffff' : headerTextColor,
                opacity: adminActiveTab === 'system_backup' ? 1 : 0.82
              }}
            >
              <Database className="h-4 w-4" />
              النسخ الاحتياطي والاستعادة
            </button>

            <button
              onClick={() => setAdminActiveTab('admin_security')}
              className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                adminActiveTab === 'admin_security'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'hover:bg-white/10'
              }`}
              style={{
                color: adminActiveTab === 'admin_security' ? '#ffffff' : headerTextColor,
                opacity: adminActiveTab === 'admin_security' ? 1 : 0.82
              }}
            >
              <KeyRound className="h-4 w-4" />
              أمان حساب الأدمن
            </button>

            <button
              onClick={() => setAdminActiveTab('tech_support')}
              className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                adminActiveTab === 'tech_support'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'hover:bg-white/10'
              }`}
              style={{
                color: adminActiveTab === 'tech_support' ? '#ffffff' : headerTextColor,
                opacity: adminActiveTab === 'tech_support' ? 1 : 0.82
              }}
            >
              <Headphones className="h-4 w-4" />
              الدعم الفني والهوية
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Global KPIs Top Cards */}
        {globalStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center border border-emerald-100 shrink-0">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-bold">العيادات النشطة</div>
                <div className="text-lg font-black text-slate-800 font-mono">
                  {globalStats.activeClinics} <span className="text-xs text-slate-400 font-normal">/ {globalStats.totalClinics}</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center border border-indigo-100 shrink-0">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-bold">إجمالي المرضى بالمنظومة</div>
                <div className="text-lg font-black text-slate-800 font-mono">
                  {globalStats.totalPatients.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 font-bold flex items-center justify-center border border-blue-100 shrink-0">
                <Receipt className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-bold">إجمالي دخل الاشتراكات</div>
                <div className="text-lg font-black text-slate-800 font-mono">
                  {(globalStats.totalSubscriptionsIncome || 0).toLocaleString()} <span className="text-xs text-slate-400 font-normal">ج.م</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-amber-50 text-amber-600 font-bold flex items-center justify-center border border-amber-100 shrink-0">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-bold">إيرادات المنظومة اليوم</div>
                <div className="text-lg font-black text-slate-800 font-mono">
                  {globalStats.todayRevenuesSum.toLocaleString()} <span className="text-xs text-slate-400 font-normal">ج.م</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Global Broadcast Announcement Banner Editor & Color Customizer */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          {/* Top Bar: Title, Status Badge & Color Options Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-200/60">
                <Megaphone className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  إعلان وتنويه عام موحد لكافة العيادات
                  {activeBroadcast ? (
                    <span 
                      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs"
                      style={{
                        backgroundColor: activeBroadcast.bgColor || '#059669',
                        color: activeBroadcast.textColor || '#ffffff'
                      }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                      إعلان نشط ومُعمم حالياً
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      لا يوجد إعلان معمم
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400">
                  شريط إخباري أو تنبيه إداري يظهر في أعلى الشاشات لكافة الأطباء وموظفي الاستقبال
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowColorCustomizer(!showColorCustomizer)}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition flex items-center gap-1.5 cursor-pointer ${
                  showColorCustomizer 
                    ? 'bg-amber-500 text-white border-amber-600 shadow-xs' 
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <Palette className="h-4 w-4" />
                <span>تخصيص لون الخلفية والنص</span>
                <span className="flex items-center gap-1 mr-1">
                  <span className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-2xs inline-block" style={{ backgroundColor: broadcastBgColor }} />
                  <span className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-2xs inline-block" style={{ backgroundColor: broadcastTextColor }} />
                </span>
              </button>

              {activeBroadcast && (
                <button
                  type="button"
                  onClick={handleClearBroadcast}
                  disabled={broadcastLoading}
                  className="px-3 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="إلغاء التنويه المعمم حالياً"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>مسح الإعلان</span>
                </button>
              )}
            </div>
          </div>

          {/* Form & Input Section */}
          <form onSubmit={handleSaveBroadcast} className="space-y-4">
            <div className="flex flex-col md:flex-row items-stretch gap-2.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  placeholder="اكتب نص الإعلان التنبيهي هنا (مثال: نود إحاطتكم بإجراء صيانة دورية اليوم من الساعة 2 إلى 3 صباحاً)..."
                  className="w-full pl-3 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-800 placeholder:text-slate-400"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  disabled={broadcastLoading || (!broadcastMessage.trim() && !activeBroadcast)}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50 flex items-center gap-2 whitespace-nowrap shadow-sm"
                >
                  {broadcastLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  <span>{broadcastLoading ? 'جاري النشر...' : broadcastMessage.trim() ? 'نشر وتعميم الإعلان بالألوان المحددة' : 'مسح التنويه'}</span>
                </button>
              </div>
            </div>

            {/* Expandable / Color Customization Panel */}
            {showColorCustomizer && (
              <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-4 animate-fade-in">
                {/* 1. Quick Presets */}
                <div>
                  <div className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    <span>أنماط جاهزة سريعة (ضغطة واحدة):</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_THEMES.map((theme, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setBroadcastBgColor(theme.bg);
                          setBroadcastTextColor(theme.text);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 cursor-pointer shadow-2xs ${
                          broadcastBgColor.toLowerCase() === theme.bg.toLowerCase() && broadcastTextColor.toLowerCase() === theme.text.toLowerCase()
                            ? 'ring-2 ring-amber-500 ring-offset-1 border-amber-500'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                        style={{
                          backgroundColor: theme.bg,
                          color: theme.text
                        }}
                      >
                        <span>{theme.label}</span>
                        {broadcastBgColor.toLowerCase() === theme.bg.toLowerCase() && broadcastTextColor.toLowerCase() === theme.text.toLowerCase() && (
                          <Check className="h-3.5 w-3.5 stroke-[3]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Color Controls Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200/60">
                  {/* Background Color Customizer */}
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{ backgroundColor: broadcastBgColor }} />
                        <span>لون خلفية شريط الإعلان:</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={broadcastBgColor}
                          onChange={(e) => setBroadcastBgColor(e.target.value)}
                          className="w-7 h-7 rounded-lg cursor-pointer border border-slate-300 p-0.5 bg-transparent"
                          title="اختر لون الخلفية"
                        />
                        <input
                          type="text"
                          value={broadcastBgColor}
                          onChange={(e) => setBroadcastBgColor(e.target.value)}
                          className="w-20 px-2 py-1 text-xs font-mono text-center bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                          placeholder="#059669"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {BG_COLOR_PRESETS.map((p, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setBroadcastBgColor(p.hex)}
                          className={`group relative w-7 h-7 rounded-lg border flex items-center justify-center transition cursor-pointer shadow-2xs ${
                            broadcastBgColor.toLowerCase() === p.hex.toLowerCase()
                              ? 'ring-2 ring-amber-500 ring-offset-1 border-amber-600 scale-110'
                              : 'border-black/15 hover:scale-105'
                          }`}
                          style={{ backgroundColor: p.hex }}
                          title={p.name}
                        >
                          {broadcastBgColor.toLowerCase() === p.hex.toLowerCase() && (
                            <Check className="h-3.5 w-3.5 text-white drop-shadow-md stroke-[3]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Color Customizer */}
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{ backgroundColor: broadcastTextColor }} />
                        <span>لون نص الإعلان والأيقونات:</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={broadcastTextColor}
                          onChange={(e) => setBroadcastTextColor(e.target.value)}
                          className="w-7 h-7 rounded-lg cursor-pointer border border-slate-300 p-0.5 bg-transparent"
                          title="اختر لون النص"
                        />
                        <input
                          type="text"
                          value={broadcastTextColor}
                          onChange={(e) => setBroadcastTextColor(e.target.value)}
                          className="w-20 px-2 py-1 text-xs font-mono text-center bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                          placeholder="#ffffff"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {TEXT_COLOR_PRESETS.map((p, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setBroadcastTextColor(p.hex)}
                          className={`group relative w-7 h-7 rounded-lg border flex items-center justify-center transition cursor-pointer shadow-2xs ${
                            broadcastTextColor.toLowerCase() === p.hex.toLowerCase()
                              ? 'ring-2 ring-amber-500 ring-offset-1 border-amber-600 scale-110'
                              : 'border-black/15 hover:scale-105'
                          }`}
                          style={{ backgroundColor: p.hex }}
                          title={p.name}
                        >
                          {broadcastTextColor.toLowerCase() === p.hex.toLowerCase() && (
                            <Check className={`h-3.5 w-3.5 stroke-[3] ${p.hex.toLowerCase() === '#ffffff' ? 'text-slate-900' : 'text-white'}`} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 3. Live Interactive Banner Preview */}
                <div className="pt-2 border-t border-slate-200/60">
                  <div className="text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5 text-indigo-600" />
                      <span>معاينة حية فورية (هكذا سيظهر الإعلان للمستخدمين في كافة العيادات):</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      خلفية: {broadcastBgColor} | نص: {broadcastTextColor}
                    </span>
                  </div>

                  <div
                    className="p-3.5 rounded-xl shadow-sm border border-black/10 transition-all flex items-center justify-between gap-3 overflow-hidden"
                    style={{
                      backgroundColor: broadcastBgColor,
                      color: broadcastTextColor
                    }}
                    dir="rtl"
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <span
                        className="flex h-6 w-6 rounded-full items-center justify-center shrink-0"
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.2)'
                        }}
                      >
                        <Megaphone className="h-3.5 w-3.5" style={{ color: broadcastTextColor }} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-black leading-relaxed" style={{ color: broadcastTextColor }}>
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-md font-bold ml-2 shrink-0 inline-block"
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.25)',
                              color: broadcastTextColor
                            }}
                          >
                            تنبيه تعميمي موحد:
                          </span>
                          {broadcastMessage.trim() || 'سيظهر نص الإعلان والتنويه هنا لكافة الأطباء وموظفي الاستقبال عبر جميع الأجهزة...'}
                        </p>
                      </div>
                    </div>

                    <div
                      className="p-1 rounded-md opacity-70 shrink-0"
                      style={{ color: broadcastTextColor }}
                    >
                      <span className="text-xs font-bold">✕</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Active Tab View */}
        {adminActiveTab === 'clinics' && (
          <ClinicsTab
            clinics={clinics}
            clinicUsage={clinicUsage}
            onRefreshClinics={fetchClinics}
            saveSession={saveSession}
          />
        )}

        {adminActiveTab === 'renewals' && (
          <AdminRenewals
            clinics={clinics}
            onRefreshClinics={async () => {
              await fetchClinics();
              await fetchAnalyticsAndBroadcast();
            }}
          />
        )}

        {adminActiveTab === 'income_stats' && (
          <IncomeStatsTab />
        )}

        {adminActiveTab === 'system_backup' && (
          <SystemBackupTab
            clinics={clinics}
            onRefreshClinics={fetchClinics}
          />
        )}

        {adminActiveTab === 'admin_security' && (
          <AdminSecurityTab />
        )}

        {adminActiveTab === 'tech_support' && (
          <TechSupportTab
            supportSettings={supportSettings}
            setSupportSettings={setSupportSettings}
            onSave={handleSaveSupportSettings}
            isSaving={isSavingSupport}
            isLoading={isLoadingSupport}
          />
        )}
      </main>
    </div>
  );
}
