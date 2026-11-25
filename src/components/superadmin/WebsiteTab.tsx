import React, { useRef, useState } from 'react';
import {
  LandingSiteContent, LandingTexts, LandingFeature, LandingPlan, LandingPain,
  LANDING_ICON_OPTIONS
} from '../../types';
import { useDialogs } from '../DialogContext';
import { uploadFileToR2 } from '../../utils/r2Upload';
import {
  Save, Plus, Trash2, Image as ImageIcon, Upload, Loader2,
  Type, Phone, LayoutGrid, ListOrdered, CreditCard, BarChart3, ExternalLink,
  Sparkles, Compass, Clock, MessageSquare, Camera
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

function Field({ label, value, onChange, placeholder, dir, inputClassName }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; dir?: string; inputClassName?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={`${inputCls} ${inputClassName || ''}`} value={value || ''} placeholder={placeholder} dir={dir} onChange={e => onChange(e.target.value)} />
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

function FaviconField({ value, onChange, uploading, setUploading, en }: {
  value: string; onChange: (v: string) => void;
  uploading: boolean; setUploading: (b: boolean) => void;
  en?: boolean;
}) {
  const dialogs = useDialogs();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewSrc = value || '/favicon.svg';
  const convertToSquarePng = (file: File): Promise<File> => new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('decode')); };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas')); return; }
      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      canvas.toBlob((blob) => {
        if (blob) resolve(new File([blob], 'favicon-512.png', { type: 'image/png' }));
        else reject(new Error('encode'));
      }, 'image/png');
    };
    img.src = objectUrl;
  });

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    // The picker accepts any image (mobile galleries hide mismatched MIME
    // filters), so type and size are validated here after the pick.
    if (!file.type || !file.type.startsWith('image/')) {
      dialogs.alert(en
        ? 'The selected file is not an image. Please choose an image file (PNG, JPG, SVG, ICO, WebP...).'
        : 'الملف المختار ليس صورة. اختر ملف صورة (PNG أو JPG أو SVG أو ICO أو WebP...).', { severity: 'error' });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      dialogs.alert(en
        ? 'The image is larger than 10 MB. Please choose a smaller icon image.'
        : 'حجم الصورة أكبر من 10 ميجابايت. اختر صورة أيقونة أصغر.', { severity: 'error' });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      // SVG and ICO keep their original bytes; every other image (JPG, WebP,
      // PNG, photos...) is converted here to a square 512x512 PNG so it works
      // as a favicon everywhere.
      const keepAsIs = ['image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(file.type);
      let toUpload: File | Blob = file;
      if (!keepAsIs) {
        try {
          toUpload = await convertToSquarePng(file);
        } catch {
          dialogs.alert(en
            ? 'This image format could not be converted here. Please pick a PNG, JPG, WebP, SVG or ICO image.'
            : 'تعذر تحويل صيغة الصورة دي هنا. اختر صورة PNG أو JPG أو WebP أو SVG أو ICO.', { severity: 'error' });
          return;
        }
      }
      const url = await uploadFileToR2(toUpload, 'landing', 'superadmin', undefined, { skipCompression: true });
      onChange(url);
      dialogs.alert('تم رفع الأيقونة وحفظ رابطها هنا. لا تنسَ الضغط على «حفظ التعديلات».', { severity: 'success' });
    } catch (err: any) {
      dialogs.alert('فشل رفع الأيقونة: ' + (err?.message || err), { severity: 'error' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const resetToDefault = () => {
    onChange('');
    dialogs.alert('سيتم الرجوع للأيقونة الافتراضية بعد الضغط على «حفظ التعديلات».', { severity: 'info' });
  };
  return (
    <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60">
      <label className={labelCls}>أيقونة الموقع (Favicon)</label>
      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
        الأيقونة الصغيرة التي تظهر في تبويب المتصفح ونتائج البحث لكل صفحات الموقع (الرئيسية و/ar و/en وتسجيل الدخول).
        ارفع صورة مربعة (يفضّل PNG أو SVG بحجم 512×512). عند تركها فارغة تُستخدم الأيقونة الافتراضية.
      </p>
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex flex-col gap-2">
          <div className="w-56 bg-white border border-slate-200 rounded-t-xl shadow-sm overflow-hidden">
            <div className="bg-slate-100 px-2.5 py-1.5 flex items-center gap-1.5 border-b border-slate-200">
              <img src={previewSrc} alt="" className="w-4 h-4 rounded" />
              <span className="text-[10px] font-semibold text-slate-600 truncate" dir="ltr">CoreDentSys</span>
            </div>
          </div>
          <div className="flex items-end gap-3">
            {[48, 32, 16].map(sz => (
              <div key={sz} className="text-center">
                <img src={previewSrc} alt="" width={sz} height={sz} className="mx-auto mb-1 rounded border border-slate-200 bg-white" />
                <span className="text-[9px] font-bold text-slate-400">{sz}px</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[220px] flex flex-col gap-2">
          <input className={inputCls} value={value || ''} dir="ltr" placeholder="اتركه فارغاً للأيقونة الافتراضية" onChange={e => onChange(e.target.value)} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 bg-slate-800 text-white rounded-xl px-3.5 py-2.5 text-xs font-bold hover:bg-slate-700 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              رفع أيقونة
            </button>
            {value && (
              <button
                type="button"
                onClick={resetToDefault}
                className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 rounded-xl px-3.5 py-2.5 text-xs font-bold hover:bg-slate-50"
              >
                استعادة الافتراضية
              </button>
            )}
          </div>
          <span className="text-[10px] text-slate-400">أي صورة بحد أقصى 10 ميجابايت — JPG وWebP وPNG تتحوّل تلقائياً لمربع PNG، وSVG/ICO تُرفع كما هي، وتُقدَّم على /favicon.ico بعد الحفظ.</span>
        </div>
      </div>
    </div>
  );
}

type SectionKey = 'identity' | 'hero' | 'images' | 'shots' | 'pains' | 'contact' | 'headerSections' | 'features' | 'stats' | 'steps' | 'plans';

interface SectionMeta {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  // Shared (language-independent) content — editable in Arabic mode only.
  sharedOnly?: boolean;
}

const SECTIONS: SectionMeta[] = [
  { key: 'identity', label: 'الهوية واللوجو', icon: Type, hint: 'اسم البراند ولوجو الموقع — بيظهروا في الهيدر والفوتر.' },
  { key: 'hero', label: 'القسم الرئيسي (الهيرو)', icon: Sparkles, hint: 'محتوى أول ما يشوفه الزائر في الصفحة الرئيسية — التعديلات تظهر فوراً بعد الحفظ.' },
  { key: 'images', label: 'صور الصفحة', icon: ImageIcon, hint: 'صور حقيقية من النظام بتظهر في الصفحة التعريفية — ارفع أي صورة جديدة أو حط رابط مباشر.', sharedOnly: true },
  { key: 'shots', label: 'تعليقات الصور والملاحظات', icon: Camera, hint: 'الكلام المكتوب بخط اليد جنب كل صورة، وملاحظة الأوفلاين، وشارة الخطة المميزة.' },
  { key: 'pains', label: 'قسم «عارف الإحساس ده؟»', icon: MessageSquare, hint: 'القسم اللي بيكلم الدكتور عن مشاكله اليومية قبل ما نتكلم عن المميزات.' },
  { key: 'contact', label: 'أرقام وروابط التواصل', icon: Phone, hint: 'رقم الواتساب هو اللي بيفتح لما الزائر يدوس على زر التجربة المجانية أو أزرار الخطط.', sharedOnly: true },
  { key: 'headerSections', label: 'الهيدر والأقسام والفوتر', icon: Compass, hint: 'روابط الهيدر وعناوين الأقسام ونص الـ CTA وسطور الفوتر.' },
  { key: 'features', label: 'بطاقات المميزات', icon: LayoutGrid, hint: 'أضف أو احذف أو عدل أي ميزة. الأيقونة تتختار من القايمة.' },
  { key: 'stats', label: 'شريط الإحصائيات', icon: BarChart3, hint: 'الشريط الملون اللي تحت الهيرو (4 خانات).' },
  { key: 'steps', label: 'خطوات البداية (3)', icon: ListOrdered, hint: 'الخطوات الثلاثة اللي بتشرح للدكتور إزاي يبدأ.' },
  { key: 'plans', label: 'خطط الأسعار', icon: CreditCard, hint: 'أضف أو احذف أو عدل أي خطة. السعر وشارة «الأكثر اختياراً» مشتركين بين اللغتين.' },
];

const arTime = (d: Date) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' }).format(d);

function formatLastSaved(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (dayDiff === 0) return `اليوم ${arTime(d)}`;
  if (dayDiff === 1) return `أمس ${arTime(d)}`;
  const date = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' }).format(d);
  return `${date} ${arTime(d)}`;
}

export default function WebsiteTab({ content, setContent, onSave, isSaving, isLoading }: WebsiteTabProps) {
  const dialogs = useDialogs();
  const [editLang, setEditLang] = useState<EditLang>('ar');
  const [activeSection, setActiveSection] = useState<SectionKey>('hero');
  const [uploading, setUploading] = useState(false);
  const [justSavedAt, setJustSavedAt] = useState<string | null>(null);
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
  const setListText = (listKey: 'features' | 'stats' | 'steps' | 'plans' | 'pains', id: string, field: string, v: any) => {
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
    setJustSavedAt(new Date().toISOString());
  };

  const visibleSections = SECTIONS.filter(s => !(en && s.sharedOnly));
  const active: SectionMeta = visibleSections.find(s => s.key === activeSection)
    || SECTIONS.find(s => s.key === 'hero')!;
  const lastSaved = formatLastSaved(justSavedAt || content.updatedAt);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mb-3 text-emerald-600" />
        <p className="text-sm font-bold">جاري تحميل محتوى الموقع...</p>
      </div>
    );
  }

  const renderSection = (key: SectionKey): React.ReactNode => {
    switch (key) {
      case 'identity':
        return (
          <div className="flex flex-col gap-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label={en ? 'Brand name (EN)' : 'اسم البراند'} value={textOf('brandName')} onChange={v => setText('brandName', v)} placeholder={ph('brandName')} dir="ltr" />
              <ImageField label="لوجو الموقع (اتركه فارغاً للوجو الافتراضي)" value={content.logoUrl} onChange={v => setShared('logoUrl', v)} uploading={uploading} setUploading={setUploading} />
            </div>
            <FaviconField value={content.faviconUrl || ''} onChange={v => setShared('faviconUrl', v)} uploading={uploading} setUploading={setUploading} en={en} />
          </div>
        );

      case 'hero':
        return (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="الشارة الصغيرة فوق العنوان" value={textOf('heroBadge')} onChange={v => setText('heroBadge', v)} placeholder={ph('heroBadge')} dir={dir} />
            <Field label="العنوان - السطر الأول" value={textOf('heroTitleA')} onChange={v => setText('heroTitleA', v)} placeholder={ph('heroTitleA')} dir={dir} />
            <Field label="العنوان - السطر الملوّن" value={textOf('heroTitleB')} onChange={v => setText('heroTitleB', v)} placeholder={ph('heroTitleB')} dir={dir} inputClassName="!text-emerald-600" />
            <Field label="زر التجربة المجانية" value={textOf('trialButtonLabel')} onChange={v => setText('trialButtonLabel', v)} placeholder={ph('trialButtonLabel')} dir={dir} />
            <div className="md:col-span-2">
              <Area label="الوصف تحت العنوان" value={textOf('heroSubtitle')} onChange={v => setText('heroSubtitle', v)} placeholder={ph('heroSubtitle')} dir={dir} rows={2} />
            </div>
            <div className="md:col-span-2 grid md:grid-cols-4 gap-3">
              <Field label="زر الأسعار" value={textOf('pricingButtonLabel')} onChange={v => setText('pricingButtonLabel', v)} placeholder={ph('pricingButtonLabel')} dir={dir} />
              <Field label="نقطة الثقة 1" value={textOf('heroPoint1')} onChange={v => setText('heroPoint1', v)} placeholder={ph('heroPoint1')} dir={dir} />
              <Field label="نقطة الثقة 2" value={textOf('heroPoint2')} onChange={v => setText('heroPoint2', v)} placeholder={ph('heroPoint2')} dir={dir} />
              <Field label="نقطة الثقة 3" value={textOf('heroPoint3')} onChange={v => setText('heroPoint3', v)} placeholder={ph('heroPoint3')} dir={dir} />
            </div>
            <div className="md:col-span-2">
              <Area label="رسالة الواتساب الجاهزة (تتبعت مع زر التجربة)" value={textOf('trialWhatsappPrefill')} onChange={v => setText('trialWhatsappPrefill', v)} placeholder={ph('trialWhatsappPrefill')} dir={dir} />
            </div>
          </div>
        );

      case 'images':
        return (
          <div className="grid md:grid-cols-2 gap-4">
            <ImageField label="الصورة الرئيسية (بجانب العنوان)" value={content.heroImageUrl} onChange={v => setShared('heroImageUrl', v)} uploading={uploading} setUploading={setUploading} />
            <ImageField label="صورة مخطط الأسنان" value={content.chartImageUrl} onChange={v => setShared('chartImageUrl', v)} uploading={uploading} setUploading={setUploading} />
            <ImageField label="صورة الحسابات" value={content.financeImageUrl} onChange={v => setShared('financeImageUrl', v)} uploading={uploading} setUploading={setUploading} />
          </div>
        );

      case 'shots':
        return (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="تعليق الصورة الرئيسية (بخط اليد)" value={textOf('heroImageCaption')} onChange={v => setText('heroImageCaption', v)} placeholder={ph('heroImageCaption')} dir={dir} />
            <Field label="تعليق صورة مخطط الأسنان (بخط اليد)" value={textOf('chartImageCaption')} onChange={v => setText('chartImageCaption', v)} placeholder={ph('chartImageCaption')} dir={dir} />
            <Field label="تعليق صورة الحسابات (بخط اليد)" value={textOf('financeImageCaption')} onChange={v => setText('financeImageCaption', v)} placeholder={ph('financeImageCaption')} dir={dir} />
            <Field label="شارة الخطة المميزة (مثال: الأكثر اختياراً)" value={textOf('planPopularTag')} onChange={v => setText('planPopularTag', v)} placeholder={ph('planPopularTag')} dir={dir} />
            <div className="md:col-span-2">
              <Area label="ملاحظة الأوفلاين (المربع الملوّن تحت ميزة الأوفلاين)" value={textOf('offlineNote')} onChange={v => setText('offlineNote', v)} placeholder={ph('offlineNote')} dir={dir} rows={3} />
            </div>
          </div>
        );

      case 'pains':
        return (
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="العنوان الصغير" value={textOf('painsKicker')} onChange={v => setText('painsKicker', v)} placeholder={ph('painsKicker')} dir={dir} />
              <Field label="العنوان الكبير" value={textOf('painsTitle')} onChange={v => setText('painsTitle', v)} placeholder={ph('painsTitle')} dir={dir} />
            </div>
            <div className="space-y-3">
              {content.pains.map((p: LandingPain, i: number) => (
                <div key={p.id} className="grid md:grid-cols-[1fr_auto] gap-3 items-end border border-slate-100 rounded-xl p-3 bg-slate-50/50">
                  <Area label={`المشكلة ${i + 1}`} value={itemText(p, 'text')} onChange={v => setListText('pains', p.id, 'text', v)} placeholder={en ? `العربي: ${p.ar.text}` : undefined} dir={dir} />
                  {!en && (
                    <button
                      onClick={() => setContent(prev => ({ ...prev, pains: prev.pains.filter(x => x.id !== p.id) }))}
                      className="text-red-500 hover:bg-red-50 rounded-lg p-2.5"
                      title="حذف المشكلة"
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
                    pains: [...prev.pains, { id: 'pn_' + Date.now(), ar: { text: '' }, en: { text: '' } }]
                  }))}
                  className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs font-bold hover:bg-emerald-100"
                >
                  <Plus className="h-4 w-4" />
                  إضافة مشكلة جديدة
                </button>
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <Area label="جملة الختام (نص عادي)" value={textOf('painsResolve')} onChange={v => setText('painsResolve', v)} placeholder={ph('painsResolve')} dir={dir} />
              <Area label="جملة الختام (الجزء العريض)" value={textOf('painsResolveStrong')} onChange={v => setText('painsResolveStrong', v)} placeholder={ph('painsResolveStrong')} dir={dir} />
              <Field label="الملاحظة بخط اليد تحت الختام" value={textOf('painsNote')} onChange={v => setText('painsNote', v)} placeholder={ph('painsNote')} dir={dir} />
            </div>
          </div>
        );

      case 'contact':
        return (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="رقم الواتساب (بكود الدولة، بدون +)" value={content.whatsappNumber} onChange={v => setShared('whatsappNumber', v)} placeholder="2010XXXXXXXX" dir="ltr" />
            <Field label="رابط مجتمع واتساب (اختياري)" value={content.whatsappCommunityUrl} onChange={v => setShared('whatsappCommunityUrl', v)} placeholder="https://chat.whatsapp.com/..." dir="ltr" />
            <Field label="رابط صفحة فيسبوك (اختياري)" value={content.facebookUrl} onChange={v => setShared('facebookUrl', v)} placeholder="https://facebook.com/..." dir="ltr" />
          </div>
        );

      case 'headerSections':
        return (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="رابط: المميزات" value={textOf('navFeatures')} onChange={v => setText('navFeatures', v)} placeholder={ph('navFeatures')} dir={dir} />
            <Field label="رابط: إزاي بيشتغل" value={textOf('navHow')} onChange={v => setText('navHow', v)} placeholder={ph('navHow')} dir={dir} />
            <Field label="رابط: الأسعار" value={textOf('navPricing')} onChange={v => setText('navPricing', v)} placeholder={ph('navPricing')} dir={dir} />
            <Field label="رابط: تواصل معنا" value={textOf('navContact')} onChange={v => setText('navContact', v)} placeholder={ph('navContact')} dir={dir} />
            <Field label="زر تسجيل الدخول" value={textOf('loginLabel')} onChange={v => setText('loginLabel', v)} placeholder={ph('loginLabel')} dir={dir} />
            <div className="hidden md:block"></div>
            <Field label="عنوان صغير: المميزات" value={textOf('featuresKicker')} onChange={v => setText('featuresKicker', v)} placeholder={ph('featuresKicker')} dir={dir} />
            <Field label="عنوان: المميزات" value={textOf('featuresTitle')} onChange={v => setText('featuresTitle', v)} placeholder={ph('featuresTitle')} dir={dir} />
            <div className="md:col-span-2">
              <Area label="وصف: المميزات" value={textOf('featuresSubtitle')} onChange={v => setText('featuresSubtitle', v)} placeholder={ph('featuresSubtitle')} dir={dir} />
            </div>
            <Field label="عنوان صغير: الخطوات" value={textOf('stepsKicker')} onChange={v => setText('stepsKicker', v)} placeholder={ph('stepsKicker')} dir={dir} />
            <Field label="عنوان: الخطوات" value={textOf('stepsTitle')} onChange={v => setText('stepsTitle', v)} placeholder={ph('stepsTitle')} dir={dir} />
            <Field label="عنوان صغير: الأسعار" value={textOf('pricingKicker')} onChange={v => setText('pricingKicker', v)} placeholder={ph('pricingKicker')} dir={dir} />
            <Field label="عنوان: الأسعار" value={textOf('pricingTitle')} onChange={v => setText('pricingTitle', v)} placeholder={ph('pricingTitle')} dir={dir} />
            <div className="md:col-span-2">
              <Area label="وصف: الأسعار" value={textOf('pricingSubtitle')} onChange={v => setText('pricingSubtitle', v)} placeholder={ph('pricingSubtitle')} dir={dir} />
            </div>
            <Field label="عنوان الـ CTA الكبير" value={textOf('ctaTitle')} onChange={v => setText('ctaTitle', v)} placeholder={ph('ctaTitle')} dir={dir} />
            <Field label="زر CTA: التجربة" value={textOf('ctaTrialLabel')} onChange={v => setText('ctaTrialLabel', v)} placeholder={ph('ctaTrialLabel')} dir={dir} />
            <div className="md:col-span-2">
              <Area label="وصف الـ CTA" value={textOf('ctaSubtitle')} onChange={v => setText('ctaSubtitle', v)} placeholder={ph('ctaSubtitle')} dir={dir} />
            </div>
            <Field label="زر CTA: تسجيل الدخول" value={textOf('ctaLoginLabel')} onChange={v => setText('ctaLoginLabel', v)} placeholder={ph('ctaLoginLabel')} dir={dir} />
            <div className="hidden md:block"></div>
            <Field label="فوتر: رابط مجتمع واتساب" value={textOf('footerCommunityLabel')} onChange={v => setText('footerCommunityLabel', v)} placeholder={ph('footerCommunityLabel')} dir={dir} />
            <Field label="فوتر: رابط فيسبوك" value={textOf('footerFacebookLabel')} onChange={v => setText('footerFacebookLabel', v)} placeholder={ph('footerFacebookLabel')} dir={dir} />
            <Field label="فوتر: الأسئلة الشائعة" value={textOf('footerFaqLabel')} onChange={v => setText('footerFaqLabel', v)} placeholder={ph('footerFaqLabel')} dir={dir} />
            <div className="md:col-span-2">
              <Area label="سطر الحقوق في الفوتر" value={textOf('footerCopyright')} onChange={v => setText('footerCopyright', v)} placeholder={ph('footerCopyright')} dir={dir} />
            </div>
          </div>
        );

      case 'features':
        return (
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
        );

      case 'stats':
        return (
          <div className="grid md:grid-cols-2 gap-3">
            {content.stats.map(s => (
              <div key={s.id} className="grid grid-cols-[1fr_2fr] gap-3 border border-slate-100 rounded-xl p-3 bg-slate-50/50">
                <Field label="القيمة" value={itemText(s, 'value')} onChange={v => setListText('stats', s.id, 'value', v)} placeholder={en ? `العربي: ${s.ar.value}` : undefined} dir={dir} />
                <Area label="الوصف" value={itemText(s, 'label')} onChange={v => setListText('stats', s.id, 'label', v)} placeholder={en ? `العربي: ${s.ar.label}` : undefined} dir={dir} />
              </div>
            ))}
          </div>
        );

      case 'steps':
        return (
          <div className="grid md:grid-cols-3 gap-3">
            {content.steps.map((s, i) => (
              <div key={s.id} className="border border-slate-100 rounded-xl p-3 bg-slate-50/50 space-y-3">
                <div className="text-xs font-black text-slate-400">الخطوة {i + 1}</div>
                <Field label="العنوان" value={itemText(s, 'title')} onChange={v => setListText('steps', s.id, 'title', v)} placeholder={en ? `العربي: ${s.ar.title}` : undefined} dir={dir} />
                <Area label="الوصف" value={itemText(s, 'desc')} onChange={v => setListText('steps', s.id, 'desc', v)} placeholder={en ? `العربي: ${s.ar.desc}` : undefined} dir={dir} />
              </div>
            ))}
          </div>
        );

      case 'plans':
        return (
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
        );
    }
  };

  const ActiveIcon = active.icon;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Sections sidebar (right in RTL) */}
        <aside className="w-full lg:w-72 shrink-0 lg:sticky lg:top-4 space-y-3">
          {/* Language toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setEditLang('ar')}
              className={`rounded-xl px-4 py-2.5 text-sm font-bold border transition-colors ${!en ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-slate-700'}`}
            >
              العربية
            </button>
            <button
              onClick={() => setEditLang('en')}
              className={`rounded-xl px-4 py-2.5 text-sm font-bold border transition-colors ${en ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-slate-700'}`}
            >
              English
            </button>
          </div>

          {en && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-2xl px-4 py-3 text-xs font-bold">
              أنت بتعدل النسخة الإنجليزية. أي حقل تسيبه فاضي هيظهر فيه النص العربي تلقائياً.
            </div>
          )}

          {/* Section list */}
          <nav className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-2 lg:grid-cols-1 gap-2">
            {visibleSections.map(s => {
              const Icon = s.icon;
              const isActive = s.key === active.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-3 text-xs font-bold transition-colors ${isActive ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-slate-800'}`}
                >
                  <span>{s.label}</span>
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                </button>
              );
            })}
          </nav>

          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-2.5 hover:bg-blue-100"
          >
            <ExternalLink className="h-4 w-4" />
            معاينة الموقع
          </a>
        </aside>

        {/* Active section card */}
        <div className="flex-1 min-w-0 w-full">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
              <span className="text-emerald-600"><ActiveIcon className="h-5 w-5" /></span>
              {active.label}
            </h3>
            {active.hint && <p className="text-[11px] text-slate-400 font-semibold mb-4">{active.hint}</p>}
            {!active.hint && <div className="mb-4"></div>}
            {renderSection(active.key)}
          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-20">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            onClick={handleSafeSave}
            disabled={isSaving}
            className="flex items-center gap-2 bg-emerald-600 text-white rounded-xl px-6 py-3 text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ محتوى الموقع
          </button>
          <p className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {lastSaved
              ? `آخر حفظ: ${lastSaved} — التعديلات تظهر فوراً على الصفحة الرئيسية`
              : 'التعديلات تظهر فوراً على الصفحة الرئيسية بعد الحفظ'}
          </p>
        </div>
      </div>
    </div>
  );
}
