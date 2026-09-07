import React, { useState } from 'react';
import { SupportSettings, SupportContact, SocialContact, DEFAULT_SUPPORT_SETTINGS } from '../../types';
import { useDialogs } from '../DialogContext';
import { formatEgyptianPhoneInput, isValidEgyptianPhone, getEgyptianPhoneError } from '../../utils/phoneUtils';
import { 
  Headphones, 
  Phone, 
  Plus, 
  Trash2, 
  Save, 
  Globe, 
  MessageSquare, 
  Clock, 
  Sparkles, 
  CheckCircle, 
  ExternalLink,
  Image as ImageIcon,
  Palette
} from 'lucide-react';
import WelcomeLoader from '../WelcomeLoader';

interface TechSupportTabProps {
  supportSettings: SupportSettings;
  setSupportSettings: React.Dispatch<React.SetStateAction<SupportSettings>>;
  onSave: () => Promise<void>;
  isSaving: boolean;
  isLoading: boolean;
}

export default function TechSupportTab({
  supportSettings,
  setSupportSettings,
  onSave,
  isSaving,
  isLoading
}: TechSupportTabProps) {
  const dialogs = useDialogs();
  const [showLoaderPreview, setShowLoaderPreview] = useState(false);

  const handleAddPhone = () => {
    if (supportSettings.phoneNumbers.length >= 10) {
      dialogs.alert('عفواً، الحد الأقصى لأرقام الدعم الفني هو 10 أرقام فقط.', { severity: 'warning' });
      return;
    }
    const newPhone: SupportContact = {
      id: 'sup_' + Date.now(),
      title: 'رقم دعم فني جديد',
      phone: '01000000000',
      availableHours: 'من 9 ص حتى 10 م'
    };
    setSupportSettings(prev => ({
      ...prev,
      phoneNumbers: [...prev.phoneNumbers, newPhone]
    }));
  };

  const handleUpdatePhone = (index: number, updated: Partial<SupportContact>) => {
    setSupportSettings(prev => {
      const nextList = [...prev.phoneNumbers];
      nextList[index] = { ...nextList[index], ...updated };
      return { ...prev, phoneNumbers: nextList };
    });
  };

  const handleDeletePhone = (index: number) => {
    setSupportSettings(prev => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.filter((_, i) => i !== index)
    }));
  };

  const handleAddSocial = () => {
    const newSocial: SocialContact = {
      id: 'soc_' + Date.now(),
      platform: 'facebook',
      title: 'صفحة جديدة',
      url: 'https://facebook.com/'
    };
    setSupportSettings(prev => ({
      ...prev,
      socialLinks: [...prev.socialLinks, newSocial]
    }));
  };

  const handleUpdateSocial = (index: number, updated: Partial<SocialContact>) => {
    setSupportSettings(prev => {
      const nextList = [...prev.socialLinks];
      nextList[index] = { ...nextList[index], ...updated };
      return { ...prev, socialLinks: nextList };
    });
  };

  const handleDeleteSocial = (index: number) => {
    setSupportSettings(prev => ({
      ...prev,
      socialLinks: prev.socialLinks.filter((_, i) => i !== index)
    }));
  };

  const handleSafeSave = async () => {
    for (let i = 0; i < supportSettings.phoneNumbers.length; i++) {
      const p = supportSettings.phoneNumbers[i];
      const err = getEgyptianPhoneError(p.phone, true, `رقم الدعم الفني #${i + 1}`);
      if (err) {
        dialogs.alert(err, { severity: 'warning' });
        return;
      }
    }
    await onSave();
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header & Save button */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Headphones className="h-6 w-6 text-emerald-600" />
            إعدادات الدعم الفني وروابط التواصل وهوية المنظومة
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            إدارة أرقام خدمة العملاء والواتساب وروابط السوشيال وشعار التحميل الرئيسي للمنظومة
          </p>
        </div>

        <button
          onClick={handleSafeSave}
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl shadow-md transition cursor-pointer text-xs disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'جاري الحفظ...' : 'حفظ ونشر التعديلات'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ================= PHONES MANAGER ================= */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-emerald-600" />
              <h3 className="font-bold text-slate-800 text-sm">أرقام الدعم الفني والواتساب ({supportSettings.phoneNumbers.length}/10)</h3>
            </div>
            <button
              onClick={handleAddPhone}
              className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer transition"
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة رقم جديد
            </button>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {supportSettings.phoneNumbers.map((phoneItem, idx) => (
              <div key={phoneItem.id || idx} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700">رقم #{idx + 1} <span className="text-[10px] text-slate-400 font-normal mr-1">(11 رقم يبدأ بـ 01)</span></span>
                  <button
                    onClick={() => handleDeletePhone(idx)}
                    className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                    title="حذف الرقم"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={phoneItem.title}
                    onChange={(e) => handleUpdatePhone(idx, { title: e.target.value })}
                    placeholder="وصف الرقم (مثلاً: دعم واتساب)"
                    className="p-2 border border-slate-200 rounded-lg bg-white text-xs font-semibold"
                  />
                  <input
                    type="tel"
                    maxLength={11}
                    inputMode="numeric"
                    value={phoneItem.phone}
                    onChange={(e) => handleUpdatePhone(idx, { phone: formatEgyptianPhoneInput(e.target.value) })}
                    placeholder="01012345678"
                    className="p-2 border border-slate-200 rounded-lg bg-white text-xs font-mono font-bold"
                    dir="ltr"
                  />
                </div>

                <input
                  type="text"
                  value={phoneItem.availableHours}
                  onChange={(e) => handleUpdatePhone(idx, { availableHours: e.target.value })}
                  placeholder="مواعيد العمل (مثلاً: يومياً من 9 ص حتى 11 م)"
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white text-xs text-slate-500"
                />
              </div>
            ))}
          </div>
        </div>

        {/* ================= SOCIAL LINKS & LOGO ================= */}
        <div className="space-y-6">
          {/* Social links */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-indigo-600" />
                <h3 className="font-bold text-slate-800 text-sm">روابط السوشيال ميديا</h3>
              </div>
              <button
                onClick={handleAddSocial}
                className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer transition"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة رابط جديد
              </button>
            </div>

            <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
              {supportSettings.socialLinks.map((social, idx) => (
                <div key={social.id || idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <select
                      value={social.platform}
                      onChange={(e) => handleUpdateSocial(idx, { platform: e.target.value as any })}
                      className="p-1.5 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 text-xs"
                    >
                      <option value="facebook">Facebook</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="instagram">Instagram</option>
                      <option value="telegram">Telegram</option>
                      <option value="website">الموقع الإلكتروني</option>
                    </select>

                    <button
                      onClick={() => handleDeleteSocial(idx)}
                      className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={social.title}
                      onChange={(e) => handleUpdateSocial(idx, { title: e.target.value })}
                      placeholder="عنوان الرابط"
                      className="p-2 border border-slate-200 rounded-lg bg-white text-xs"
                    />
                    <input
                      type="text"
                      value={social.url}
                      onChange={(e) => handleUpdateSocial(idx, { url: e.target.value })}
                      placeholder="الرابط URL"
                      className="p-2 border border-slate-200 rounded-lg bg-white text-xs font-mono"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* System Logo & Notice */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-emerald-600" />
              هوية وشعار المنظومة الافتراضي
            </h3>

            <div className="space-y-2 text-xs">
              <label className="block font-bold text-slate-700">رابط الشعار الافتراضي (Default Logo URL):</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={supportSettings.defaultSystemLogoUrl || ''}
                  onChange={(e) => setSupportSettings(prev => ({ ...prev, defaultSystemLogoUrl: e.target.value }))}
                  placeholder="https://..."
                  className="flex-1 p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowLoaderPreview(true)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition whitespace-nowrap"
                >
                  معاينة شاشة التحميل
                </button>
              </div>
            </div>

            <div className="space-y-1 text-xs pt-2">
              <label className="block font-bold text-slate-700">تنويه ساعات العمل والدعم:</label>
              <textarea
                rows={2}
                value={supportSettings.workingHoursNotice || ''}
                onChange={(e) => setSupportSettings(prev => ({ ...prev, workingHoursNotice: e.target.value }))}
                placeholder="تنويه يظهر في شاشات تسجيل الدخول والعيادات..."
                className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white text-xs"
              />
            </div>
          </div>

          {/* SuperAdmin Header Appearance */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Palette className="h-4 w-4 text-emerald-600" />
              مظهر ولون البار العلوي للسوبر أدمن
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">لون خلفية البار:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={supportSettings.superAdminHeaderBg || '#0f172a'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSupportSettings(prev => ({ ...prev, superAdminHeaderBg: val }));
                      try {
                        localStorage.setItem('crowndent_superadmin_header_bg', val);
                      } catch (err) {}
                    }}
                    className="w-9 h-9 rounded-xl border border-slate-200 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={supportSettings.superAdminHeaderBg || '#0f172a'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSupportSettings(prev => ({ ...prev, superAdminHeaderBg: val }));
                      try {
                        localStorage.setItem('crowndent_superadmin_header_bg', val);
                      } catch (err) {}
                    }}
                    className="flex-1 p-2 border border-slate-200 rounded-xl bg-slate-50 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">لون نصوص البار:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={supportSettings.superAdminHeaderTextColor || '#ffffff'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSupportSettings(prev => ({ ...prev, superAdminHeaderTextColor: val }));
                      try {
                        localStorage.setItem('crowndent_superadmin_header_text', val);
                      } catch (err) {}
                    }}
                    className="w-9 h-9 rounded-xl border border-slate-200 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={supportSettings.superAdminHeaderTextColor || '#ffffff'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSupportSettings(prev => ({ ...prev, superAdminHeaderTextColor: val }));
                      try {
                        localStorage.setItem('crowndent_superadmin_header_text', val);
                      } catch (err) {}
                    }}
                    className="flex-1 p-2 border border-slate-200 rounded-xl bg-slate-50 font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Quick header preview pill */}
            <div 
              className="p-3 rounded-xl border flex items-center justify-between text-xs font-bold shadow-xs transition-colors"
              style={{
                backgroundColor: supportSettings.superAdminHeaderBg || '#0f172a',
                color: supportSettings.superAdminHeaderTextColor || '#ffffff',
                borderColor: 'rgba(0,0,0,0.1)'
              }}
            >
              <span>معاينة مظهر البار العلوي</span>
              <span className="text-[10px] opacity-80">CrownDent SuperAdmin</span>
            </div>
          </div>
        </div>
      </div>

      {/* Welcome Loader Preview Modal */}
      {showLoaderPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="relative w-full h-full">
            <button
              onClick={() => setShowLoaderPreview(false)}
              className="absolute top-6 left-6 z-50 px-4 py-2 bg-white/20 hover:bg-white/40 text-white rounded-xl font-bold text-xs backdrop-blur-md transition"
            >
              إغلاق المعاينة ✕
            </button>
            <WelcomeLoader
              logoUrl={supportSettings.defaultSystemLogoUrl}
              onComplete={() => setShowLoaderPreview(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
