import React, { useRef, useState } from 'react';
import {
  LandingSiteContent, LandingTexts, LandingFeature, LandingPlan,
  LANDING_ICON_OPTIONS
} from '../../types';
import { useDialogs } from '../DialogContext';
import { uploadFileToR2 } from '../../utils/r2Upload';
import {
  Globe, Save, Plus, Trash2, Image as ImageIcon, Upload, Loader2,
  Type, Phone, LayoutGrid, ListOrdered, CreditCard, BarChart3, ExternalLink
} from 'lucide-react';

type EditLang = 'ar' | 'en';

interface WebsiteTabProps {
  content: LandingSiteContent;
  setContent: React.Dispatch<React.SetStateAction<LandingSiteContent>>;
  onSave: () => Promise<void>;
  isSaving: boolean;
  isLoading: boolean;
}

const inputCls = 'w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white';
const labelCls = 'block text-xs font-bold text-slate-500 mb-1.5';

function Card({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
      <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
        <span className="text-emerald-600">{icon}</span>
        {title}
      </h3>
      {hint && <p className="text-[11px] text-slate-400 font-semibold mb-4">{hint}</p>}
      {!hint && <div className="mb-4"></div>}
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, dir }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; dir?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} value={value || ''} placeholder={placeholder} dir={dir} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function Area({ label, value, onChange, rows = 2, placeholder, dir }: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; dir?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <textarea className={`${inputCls} whitespace-break-spaces resize-y`} rows={rows} value={value || ''} placeholder={placeholder} dir={dir} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function ImageField({ label, value, onChange, uploading, setUploading }: {
  label: string; value: string; onChange: (v: string) => void;
  uploading: boolean; setUploading: (b: boolean) => void;
}) {
  const dialogs = useDialogs();
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFileToR2(file, 'landing', 'superadmin');
      onChange(url);
      dialogs.alert('تم رفع الصورة بنجاح وحفظ رابطها هنا. لا تنسَ الضغط على «حفظ التعديلات».', { severity: 'success' });
    } catch (err: any) {
      dialogs.alert('فشل رفع الصورة: ' + (err?.message || err), { severity: 'error' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex items-center gap-2">
        <input className={inputCls} value={value || ''} dir="ltr" placeholder="https://... أو /landing/image.jpg" onChange={e => onChange(e.target.value)} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="shrink-0 flex items-center gap-1.5 bg-slate-800 text-white rounded-xl px-3.5 py-2.5 text-xs font-bold hover:bg-slate-700 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          رفع
        </button>
      </div>
      {value && (
        <img src={value} alt="" className="mt-2 h-20 rounded-lg border border-slate-200 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}
    </div>
  );
}

export default function WebsiteTab({ content, setContent, onSave, isSaving, isLoading }: WebsiteTabProps) {
  const dialogs = useDialogs();
  const [editLang, setEditLang] = useState<EditLang>('ar');
  const [uploading, setUploading] = useState(false);
  const en = editLang === 'en';
  const dir = en ? 'ltr' : 'rtl';

  // ---- text helpers (per language, English falls back to Arabic placeholders) ----
  const textOf = (key: keyof LandingTexts): string => {
    if (en) return (content.en?.[key] as string) ?? '';
    return content.ar[key] ?? '';
  };
  const setText = (key: keyof LandingTexts, v: string) => {
    setContent(prev => en
      ? { ...prev, en: { ...(prev.en || {}), [key]: v } }
      : { ...prev, ar: { ...prev.ar, [key]: v } });
  };
  const ph = (key: keyof LandingTexts) => en ? `العربي: ${content.ar[key] || ''}` : undefined;

  // ---- generic list item text helpers (features / stats / steps / plans) ----
  const setListText = (listKey: 'features' | 'stats' | 'steps' | 'plans', id: string, field: string, v: any) => {
    setContent(prev => ({
      ...prev,
      [listKey]: (prev[listKey] as any[]).map(item => {
        if (item.id !== id) return item;
        const langBlock = { ...(item[editLang] || {}), [field]: v };
        return { ...item, [editLang]: langBlock };
      })
    }));
  };
  const itemText = (item: any, field: string): string => {
    const v = item?.[editLang]?.[field];
    if (v !== undefined && v !== null) return v;
    return en ? '' : (item?.ar?.[field] ?? '');
  };
  const setShared = (key: keyof LandingSiteContent, v: any) => setContent(prev => ({ ...prev, [key]: v }));

  const handleSafeSave = async () => {
    if (!content.ar.brandName.trim()) {
      dialogs.alert('اسم البراند بالعربي لا يمكن يكون فاضي.', { severity: 'warning' });
      return;
    }
    await onSave();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mb-3 text-emerald-600" />
        <p className="text-sm font-bold">جاري تحميل محتوى الموقع...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Globe className="h-6 w-6 text-emerald-600" />
            محتوى الموقع التعريفي (الصفحة الرئيسية)
          </h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            كل نص وصورة ورقم تواصل وخطة أسعار في الصفحة التعريفية يتعدل من هنا — بدون أي تعديل في الكود.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <a href="/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-2.5 hover:bg-blue-100">
            <ExternalLink className="h-4 w-4" />
            معاينة الموقع
          </a>
          <div className="flex bg-slate-100 rounded-xl p-1 text-xs font-bold">
            <button onClick={() => setEditLang('ar')} className={`px-4 py-2 rounded-lg transition-colors ${!en ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>العربية</button>
            <button onClick={() => setEditLang('en')} className={`px-4 py-2 rounded-lg transition-colors ${en ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>English</button>
          </div>
          <button
            onClick={handleSafeSave}
            disabled={isSaving}
            className="flex items-center gap-2 bg-emerald-600 text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ التعديلات
          </button>
        </div>
      </div>

      {en && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-2xl px-4 py-3 text-xs font-bold">
          أنت بتعدل النسخة الإنجليزية. أي حقل تسيبه فاضي هيظهر فيه النص العربي تلقائياً.
        </div>
      )}

      {/* Identity */}
      <Card icon={<Type className="h-5 w-5" />} title="الهوية واللوجو">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label={en ? 'Brand name (EN)' : 'اسم البراند'} value={textOf('brandName')} onChange={v => setText('brandName', v)} placeholder={ph('brandName')} dir="ltr" />
          <ImageField label="لوجو الموقع (اتركه فارغاً للوجو الافتراضي)" value={content.logoUrl} onChange={v => setShared('logoUrl', v)} uploading={uploading} setUploading={setUploading} />
        </div>
      </Card>

      {/* Hero texts */}
      <Card icon={<LayoutGrid className="h-5 w-5" />} title={en ? 'Hero section (EN)' : 'القسم الرئيسي (الهيرو)'}>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="الشارة الصغيرة فوق العنوان" value={textOf('heroBadge')} onChange={v => setText('heroBadge', v)} placeholder={ph('heroBadge')} dir={dir} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="العنوان - السطر الأول" value={textOf('heroTitleA')} onChange={v => setText('heroTitleA', v)} placeholder={ph('heroTitleA')} dir={dir} />
            <Field label="العنوان - السطر الملوّن" value={textOf('heroTitleB')} onChange={v => setText('heroTitleB', v)} placeholder={ph('heroTitleB')} dir={dir} />
          </div>
          <div className="md:col-span-2">
            <Area label="الوصف تحت العنوان" value={textOf('heroSubtitle')} onChange={v => setText('heroSubtitle', v)} placeholder={ph('heroSubtitle')} dir={dir} rows={3} />
          </div>
          <Field label="زر التجربة المجانية" value={textOf('trialButtonLabel')} onChange={v => setText('trialButtonLabel', v)} placeholder={ph('trialButtonLabel')} dir={dir} />
          <Field label="زر الأسعار" value={textOf('pricingButtonLabel')} onChange={v => setText('pricingButtonLabel', v)} placeholder={ph('pricingButtonLabel')} dir={dir} />
          <Field label="نقطة الثقة 1" value={textOf('heroPoint1')} onChange={v => setText('heroPoint1', v)} placeholder={ph('heroPoint1')} dir={dir} />
          <Field label="نقطة الثقة 2" value={textOf('heroPoint2')} onChange={v => setText('heroPoint2', v)} placeholder={ph('heroPoint2')} dir={dir} />
          <Field label="نقطة الثقة 3" value={textOf('heroPoint3')} onChange={v => setText('heroPoint3', v)} placeholder={ph('heroPoint3')} dir={dir} />
          <Area label="رسالة الواتساب الجاهزة (تتبعت مع زر التجربة)" value={textOf('trialWhatsappPrefill')} onChange={v => setText('trialWhatsappPrefill', v)} placeholder={ph('trialWhatsappPrefill')} dir={dir} />
        </div>
      </Card>

      {/* Images */}
      {!en && (
        <Card icon={<ImageIcon className="h-5 w-5" />} title="صور الصفحة" hint="صور حقيقية من النظام بتظهر في الصفحة التعريفية — ارفع أي صورة جديدة أو حط رابط مباشر.">
          <div className="grid md:grid-cols-3 gap-4">
            <ImageField label="الصورة الرئيسية (بجانب العنوان)" value={content.heroImageUrl} onChange={v => setShared('heroImageUrl', v)} uploading={uploading} setUploading={setUploading} />
            <ImageField label="صورة مخطط الأسنان" value={content.chartImageUrl} onChange={v => setShared('chartImageUrl', v)} uploading={uploading} setUploading={setUploading} />
            <ImageField label="صورة الحسابات" value={content.financeImageUrl} onChange={v => setShared('financeImageUrl', v)} uploading={uploading} setUploading={setUploading} />
          </div>
        </Card>
      )}

      {/* Contact */}
      {!en && (
        <Card icon={<Phone className="h-5 w-5" />} title="أرقام وروابط التواصل" hint="رقم الواتساب هو اللي بيفتح لما الزائر يدوس على زر التجربة المجانية أو أزرار الخطط.">
          <div className="grid md:grid-cols-3 gap-4">
            <Field label="رقم الواتساب (بكود الدولة، بدون +)" value={content.whatsappNumber} onChange={v => setShared('whatsappNumber', v)} placeholder="2010XXXXXXXX" dir="ltr" />
            <Field label="رابط مجتمع واتساب (اختياري)" value={content.whatsappCommunityUrl} onChange={v => setShared('whatsappCommunityUrl', v)} placeholder="https://chat.whatsapp.com/..." dir="ltr" />
            <Field label="رابط صفحة فيسبوك (اختياري)" value={content.facebookUrl} onChange={v => setShared('facebookUrl', v)} placeholder="https://facebook.com/..." dir="ltr" />
          </div>
        </Card>
      )}

      {/* Nav / sections titles / CTA / footer */}
      <Card icon={<Type className="h-5 w-5" />} title={en ? 'Nav, section titles, CTA & footer (EN)' : 'الهيدر وعناوين الأقسام والفوتر'}>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="رابط: المميزات" value={textOf('navFeatures')} onChange={v => setText('navFeatures', v)} placeholder={ph('navFeatures')} dir={dir} />
          <Field label="رابط: إزاي بيشتغل" value={textOf('navHow')} onChange={v => setText('navHow', v)} placeholder={ph('navHow')} dir={dir} />
          <Field label="رابط: الأسعار" value={textOf('navPricing')} onChange={v => setText('navPricing', v)} placeholder={ph('navPricing')} dir={dir} />
          <Field label="رابط: تواصل معنا" value={textOf('navContact')} onChange={v => setText('navContact', v)} placeholder={ph('navContact')} dir={dir} />
          <Field label="زر تسجيل الدخول" value={textOf('loginLabel')} onChange={v => setText('loginLabel', v)} placeholder={ph('loginLabel')} dir={dir} />
          <div></div>
          <Field label="عنوان صغير: المميزات" value={textOf('featuresKicker')} onChange={v => setText('featuresKicker', v)} placeholder={ph('featuresKicker')} dir={dir} />
          <Field label="عنوان: المميزات" value={textOf('featuresTitle')} onChange={v => setText('featuresTitle', v)} placeholder={ph('featuresTitle')} dir={dir} />
          <Area label="وصف: المميزات" value={textOf('featuresSubtitle')} onChange={v => setText('featuresSubtitle', v)} placeholder={ph('featuresSubtitle')} dir={dir} />
          <Field label="عنوان صغير: الخطوات" value={textOf('stepsKicker')} onChange={v => setText('stepsKicker', v)} placeholder={ph('stepsKicker')} dir={dir} />
          <Field label="عنوان: الخطوات" value={textOf('stepsTitle')} onChange={v => setText('stepsTitle', v)} placeholder={ph('stepsTitle')} dir={dir} />
          <div></div>
          <Field label="عنوان صغير: الأسعار" value={textOf('pricingKicker')} onChange={v => setText('pricingKicker', v)} placeholder={ph('pricingKicker')} dir={dir} />
          <Field label="عنوان: الأسعار" value={textOf('pricingTitle')} onChange={v => setText('pricingTitle', v)} placeholder={ph('pricingTitle')} dir={dir} />
          <Area label="وصف: الأسعار" value={textOf('pricingSubtitle')} onChange={v => setText('pricingSubtitle', v)} placeholder={ph('pricingSubtitle')} dir={dir} />
          <Field label="عنوان الـ CTA الكبير" value={textOf('ctaTitle')} onChange={v => setText('ctaTitle', v)} placeholder={ph('ctaTitle')} dir={dir} />
          <Area label="وصف الـ CTA" value={textOf('ctaSubtitle')} onChange={v => setText('ctaSubtitle', v)} placeholder={ph('ctaSubtitle')} dir={dir} />
          <div></div>
          <Field label="زر CTA: التجربة" value={textOf('ctaTrialLabel')} onChange={v => setText('ctaTrialLabel', v)} placeholder={ph('ctaTrialLabel')} dir={dir} />
          <Field label="زر CTA: تسجيل الدخول" value={textOf('ctaLoginLabel')} onChange={v => setText('ctaLoginLabel', v)} placeholder={ph('ctaLoginLabel')} dir={dir} />
          <div></div>
          <Field label="فوتر: رابط مجتمع واتساب" value={textOf('footerCommunityLabel')} onChange={v => setText('footerCommunityLabel', v)} placeholder={ph('footerCommunityLabel')} dir={dir} />
          <Field label="فوتر: رابط فيسبوك" value={textOf('footerFacebookLabel')} onChange={v => setText('footerFacebookLabel', v)} placeholder={ph('footerFacebookLabel')} dir={dir} />
          <Field label="فوتر: الأسئلة الشائعة" value={textOf('footerFaqLabel')} onChange={v => setText('footerFaqLabel', v)} placeholder={ph('footerFaqLabel')} dir={dir} />
          <div className="md:col-span-3">
            <Area label="سطر الحقوق في الفوتر" value={textOf('footerCopyright')} onChange={v => setText('footerCopyright', v)} placeholder={ph('footerCopyright')} dir={dir} />
          </div>
        </div>
      </Card>

      {/* Features */}
      <Card icon={<LayoutGrid className="h-5 w-5" />} title={en ? 'Feature cards (EN)' : 'بطاقات المميزات'} hint={en ? undefined : 'أضف أو احذف أو عدل أي ميزة. الأيقونة تتختار من القايمة.'}>
        <div className="space-y-3">
          {content.features.map((f: LandingFeature) => (
            <div key={f.id} className="grid md:grid-cols-[140px_1fr_2fr_auto] gap-3 items-end border border-slate-100 rounded-xl p-3 bg-slate-50/50">
              {!en ? (
                <div>
                  <label className={labelCls}>الأيقونة</label>
                  <select
                    className={inputCls}
                    value={f.icon}
                    onChange={e => setContent(prev => ({ ...prev, features: prev.features.map(x => x.id === f.id ? { ...x, icon: e.target.value } : x) }))}
                  >
                    {LANDING_ICON_OPTIONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
                  </select>
                </div>
              ) : <div></div>}
              <Field label="العنوان" value={itemText(f, 'title')} onChange={v => setListText('features', f.id, 'title', v)} placeholder={en ? `العربي: ${f.ar.title}` : undefined} dir={dir} />
              <Area label="الوصف" value={itemText(f, 'desc')} onChange={v => setListText('features', f.id, 'desc', v)} placeholder={en ? `العربي: ${f.ar.desc}` : undefined} dir={dir} />
              {!en && (
                <button
                  onClick={() => setContent(prev => ({ ...prev, features: prev.features.filter(x => x.id !== f.id) }))}
                  className="text-red-500 hover:bg-red-50 rounded-lg p-2.5"
                  title="حذف الميزة"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {!en && (
            <button
              onClick={() => setContent(prev => ({
                ...prev,
                features: [...prev.features, { id: 'f_' + Date.now(), icon: 'check', ar: { title: 'ميزة جديدة', desc: '' }, en: { title: '', desc: '' } }]
              }))}
              className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs font-bold hover:bg-emerald-100"
            >
              <Plus className="h-4 w-4" />
              إضافة ميزة جديدة
            </button>
          )}
        </div>
      </Card>

      {/* Stats */}
      <Card icon={<BarChart3 className="h-5 w-5" />} title={en ? 'Stats strip (EN)' : 'شريط الإحصائيات'} hint={en ? undefined : 'الشريط الملون اللي تحت الهيرو (4 خانات).'}>
        <div className="grid md:grid-cols-2 gap-3">
          {content.stats.map(s => (
            <div key={s.id} className="grid grid-cols-[1fr_2fr] gap-3 border border-slate-100 rounded-xl p-3 bg-slate-50/50">
              <Field label="القيمة" value={itemText(s, 'value')} onChange={v => setListText('stats', s.id, 'value', v)} placeholder={en ? `العربي: ${s.ar.value}` : undefined} dir={dir} />
              <Area label="الوصف" value={itemText(s, 'label')} onChange={v => setListText('stats', s.id, 'label', v)} placeholder={en ? `العربي: ${s.ar.label}` : undefined} dir={dir} />
            </div>
          ))}
        </div>
      </Card>

      {/* Steps */}
      <Card icon={<ListOrdered className="h-5 w-5" />} title={en ? 'Steps (EN)' : 'خطوات البداية (3)'}>
        <div className="grid md:grid-cols-3 gap-3">
          {content.steps.map((s, i) => (
            <div key={s.id} className="border border-slate-100 rounded-xl p-3 bg-slate-50/50 space-y-3">
              <div className="text-xs font-black text-slate-400">الخطوة {i + 1}</div>
              <Field label="العنوان" value={itemText(s, 'title')} onChange={v => setListText('steps', s.id, 'title', v)} placeholder={en ? `العربي: ${s.ar.title}` : undefined} dir={dir} />
              <Area label="الوصف" value={itemText(s, 'desc')} onChange={v => setListText('steps', s.id, 'desc', v)} placeholder={en ? `العربي: ${s.ar.desc}` : undefined} dir={dir} />
            </div>
          ))}
        </div>
      </Card>

      {/* Plans */}
      <Card icon={<CreditCard className="h-5 w-5" />} title={en ? 'Pricing plans (EN)' : 'خطط الأسعار'} hint={en ? 'Prices and the popular badge are shared between languages; here you edit the English copy.' : 'أضف أو احذف أو عدل أي خطة. السعر وشارة «الأكثر اختياراً» مشتركين بين اللغتين.'}>
        <div className="space-y-4">
          {content.plans.map((p: LandingPlan) => (
            <div key={p.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
              <div className="grid md:grid-cols-4 gap-3 mb-3">
                <Field label="اسم الخطة" value={itemText(p, 'name')} onChange={v => setListText('plans', p.id, 'name', v)} placeholder={en ? `العربي: ${p.ar.name}` : undefined} dir={dir} />
                <Area label="وصف قصير" value={itemText(p, 'desc')} onChange={v => setListText('plans', p.id, 'desc', v)} placeholder={en ? `العربي: ${p.ar.desc}` : undefined} dir={dir} />
                {!en ? (
                  <Field label="السعر (رقم)" value={p.price} onChange={v => setContent(prev => ({ ...prev, plans: prev.plans.map(x => x.id === p.id ? { ...x, price: v } : x) }))} dir="ltr" />
                ) : <div></div>}
                <Field label="مدة السعر (مثال: ج.م / شهرياً)" value={itemText(p, 'period')} onChange={v => setListText('plans', p.id, 'period', v)} placeholder={en ? `العربي: ${p.ar.period}` : undefined} dir={dir} />
              </div>
              <div className="grid md:grid-cols-[1fr_220px] gap-3">
                <Area
                  label="المميزات (سطر لكل ميزة)"
                  value={(() => {
                    const feats = en ? (p.en?.features ?? []) : p.ar.features;
                    return Array.isArray(feats) ? feats.join('\n') : '';
                  })()}
                  // Keep unfinished lines/spaces while typing; trimming here eats Enter and Space.
                  onChange={v => setListText('plans', p.id, 'features', v === '' ? [] : v.split('\n'))}
                  rows={4}
                  placeholder={en ? 'اتركها فارغة لاستخدام القائمة العربية' : 'ميزة في كل سطر'}
                  dir={dir}
                />
                <div className="space-y-3">
                  <Field label="نص الزر" value={itemText(p, 'buttonLabel')} onChange={v => setListText('plans', p.id, 'buttonLabel', v)} placeholder={en ? `العربي: ${p.ar.buttonLabel}` : undefined} dir={dir} />
                  {!en && (
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={p.popular}
                        onChange={e => setContent(prev => ({ ...prev, plans: prev.plans.map(x => x.id === p.id ? { ...x, popular: e.target.checked } : x) }))}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      خطة مميزة «الأكثر اختياراً»
                    </label>
                  )}
                  {!en && (
                    <button
                      onClick={() => {
                        if (content.plans.length <= 1) {
                          dialogs.alert('لازم تفضل خطة واحدة على الأقل في الصفحة.', { severity: 'warning' });
                          return;
                        }
                        setContent(prev => ({ ...prev, plans: prev.plans.filter(x => x.id !== p.id) }));
                      }}
                      className="flex items-center gap-1.5 text-red-500 text-xs font-bold hover:bg-red-50 rounded-lg px-2.5 py-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      حذف الخطة
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!en && (
            <button
              onClick={() => setContent(prev => ({
                ...prev,
                plans: [...prev.plans, {
                  id: 'p_' + Date.now(),
                  price: '0',
                  popular: false,
                  ar: { name: 'خطة جديدة', desc: '', period: 'ج.م / شهرياً', features: [], buttonLabel: 'ابدأ التجربة المجانية' },
                  en: { name: '', desc: '', period: '', features: [], buttonLabel: '' }
                }]
              }))}
              className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs font-bold hover:bg-emerald-100"
            >
              <Plus className="h-4 w-4" />
              إضافة خطة جديدة
            </button>
          )}
        </div>
      </Card>

      <div className="flex justify-end pb-4">
        <button
          onClick={handleSafeSave}
          disabled={isSaving}
          className="flex items-center gap-2 bg-emerald-600 text-white rounded-xl px-7 py-3 text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          حفظ التعديلات
        </button>
      </div>
    </div>
  );
}
