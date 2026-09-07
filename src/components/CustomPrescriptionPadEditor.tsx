import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Trash2, Eye, EyeOff, RotateCcw, Move, Type, Maximize2, Sparkles, Check, FileText, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { CustomPrescriptionPadConfig, DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG } from '../types';
import { safeStorage, getEffectivePadConfig, saveEffectivePadConfig } from '../utils/storage';
import { uploadFileToR2 } from '../utils/r2Upload';


interface CustomPrescriptionPadEditorProps {
  config: CustomPrescriptionPadConfig;
  onChange: (newConfig: CustomPrescriptionPadConfig) => void;
  doctorName?: string;
  clinicName?: string;
  clinicId?: string;
}

type ElementKey = 'patientName' | 'patientAge' | 'date' | 'medicationsBox' | 'notesBox';

const ELEMENT_LABELS: Record<ElementKey, { title: string; color: string; bg: string; border: string }> = {
  patientName: { title: 'اسم المريض', color: 'text-blue-700', bg: 'bg-blue-50/90', border: 'border-blue-400' },
  patientAge: { title: 'العمر', color: 'text-amber-700', bg: 'bg-amber-50/90', border: 'border-amber-400' },
  date: { title: 'التاريخ', color: 'text-emerald-700', bg: 'bg-emerald-50/90', border: 'border-emerald-400' },
  medicationsBox: { title: 'مربع الأدوية', color: 'text-purple-700', bg: 'bg-purple-50/90', border: 'border-purple-400' },
  notesBox: { title: 'مربع الملاحظات', color: 'text-rose-700', bg: 'bg-rose-50/90', border: 'border-rose-400' }
};

const getElementTitle = (key: ElementKey, isEn: boolean): string => {
  if (isEn) {
    switch (key) {
      case 'patientName': return 'Patient Name';
      case 'patientAge': return 'Age';
      case 'date': return 'Date';
      case 'medicationsBox': return 'Medications Box';
      case 'notesBox': return 'Notes Box';
    }
  }
  return ELEMENT_LABELS[key].title;
};

export const CustomPrescriptionPadEditor: React.FC<CustomPrescriptionPadEditorProps> = ({
  config,
  onChange,
  doctorName = 'د. محمد السعدني',
  clinicName = 'عيادة الأسنان التخصصية',
  clinicId
}) => {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [selectedElement, setSelectedElement] = useState<ElementKey>('patientName');
  const [isDragging, setIsDragging] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const activeConfig = getEffectivePadConfig(clinicId, config);

  const emitChange = (newConfig: CustomPrescriptionPadConfig) => {
    saveEffectivePadConfig(clinicId, newConfig);
    onChange(newConfig);
  };

  // Compress image to fit within limits
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxWidth = 1000;
          const maxHeight = 1414;
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.80);
          resolve(compressedDataUrl);
        };
        img.onerror = () => resolve(e.target?.result as string || '');
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  };

  // Handle Image Upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      alert(isEn ? 'Image size is too large, please choose an image under 15 MB' : 'حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 15 ميجابايت');
      return;
    }

    setIsCompressing(true);
    try {
      let imageUrl = '';
      try {
        imageUrl = await uploadFileToR2(file, 'prescriptions', clinicId);
      } catch (r2Err) {
        console.warn('R2 direct upload failed, falling back to local compression:', r2Err);
        imageUrl = await compressImage(file);
      }

      if (imageUrl) {
        const newCfg = {
          ...activeConfig,
          backgroundImage: imageUrl
        };
        emitChange(newCfg);
      }
    } catch (err) {
      console.error('Failed to process image:', err);
      alert(isEn ? 'An error occurred while processing the image, please try another image' : 'حدث خطأ أثناء معالجة الصورة، يرجى تجربة صورة أخرى');
    } finally {
      setIsCompressing(false);
    }
  };


  const handleRemoveImage = () => {
    const newCfg = {
      ...activeConfig,
      backgroundImage: ''
    };
    emitChange(newCfg);
  };

  const handleToggleHideOnPrint = () => {
    const newCfg = {
      ...activeConfig,
      hideBackgroundOnPrint: !activeConfig.hideBackgroundOnPrint
    };
    emitChange(newCfg);
  };

  // Update specific element position/size
  const updateElementConfig = (key: ElementKey, updates: Partial<typeof activeConfig[ElementKey]>) => {
    const newCfg = {
      ...activeConfig,
      [key]: {
        ...activeConfig[key],
        ...updates
      }
    };
    emitChange(newCfg);
  };

  // Reset to default positions
  const handleReset = () => {
    const newCfg = {
      ...DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG,
      backgroundImage: activeConfig.backgroundImage,
      hideBackgroundOnPrint: activeConfig.hideBackgroundOnPrint
    };
    emitChange(newCfg);
  };

  // Dragging logic over canvas (Mouse + Touch)
  const handleMouseDown = (key: ElementKey, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setSelectedElement(key);
    setIsDragging(true);
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging || !canvasRef.current || !selectedElement) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    let leftPercent = Math.max(0, Math.min(92, Math.round((x / rect.width) * 100)));
    let topPercent = Math.max(0, Math.min(92, Math.round((y / rect.height) * 100)));

    updateElementConfig(selectedElement, {
      top: topPercent,
      left: leftPercent
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const nudgeElement = (key: ElementKey, direction: 'up' | 'down' | 'left' | 'right', step = 1) => {
    const current = activeConfig[key];
    if (!current) return;

    if (direction === 'up') {
      updateElementConfig(key, { top: Math.max(0, current.top - step) });
    } else if (direction === 'down') {
      updateElementConfig(key, { top: Math.min(95, current.top + step) });
    } else if (direction === 'left') {
      updateElementConfig(key, { left: Math.max(0, current.left - step) });
    } else if (direction === 'right') {
      updateElementConfig(key, { left: Math.min(95, current.left + step) });
    }
  };

  // Keyboard arrow keys listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }

      if (!selectedElement) return;

      const step = e.shiftKey ? 5 : 1;
      let handled = false;

      if (e.key === 'ArrowUp') {
        nudgeElement(selectedElement, 'up', step);
        handled = true;
      } else if (e.key === 'ArrowDown') {
        nudgeElement(selectedElement, 'down', step);
        handled = true;
      } else if (e.key === 'ArrowLeft') {
        nudgeElement(selectedElement, 'left', step);
        handled = true;
      } else if (e.key === 'ArrowRight') {
        nudgeElement(selectedElement, 'right', step);
        handled = true;
      }

      if (handled) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElement, activeConfig]);


  const currentElConfig = activeConfig[selectedElement];

  return (
    <div className="space-y-6 bg-slate-900/95 text-white p-6 rounded-3xl border border-slate-800 shadow-2xl" dir={isEn ? "ltr" : "rtl"}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-black text-white">
              {isEn ? 'Custom Printed Prescription Pad Designer' : 'مُخصص تصميم الروشتة المطبوعة (الروشتة الجاهزة)'}
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {isEn
              ? 'Upload a photo or scan of your clinic printed stationery pad, then drag elements to position print areas with high precision.'
              : 'اقم برفع صورة الروشتة المطبوعة لدى عيادتك، ثم اسحب الخانات والمربعات بالماوس لضبط أماكن الطباعة بدقة متناهية.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-all border border-slate-700"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>{isEn ? 'Reset Positions' : 'إعادة ضبط المواضع'}</span>
        </button>
      </div>

      {/* Upload and Print settings bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Background Upload */}
        <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/80 space-y-3">
          <label className="block text-xs font-bold text-slate-200">
            {isEn ? 'Prescription Pad Background Image:' : 'صورة خلفية الروشتة المطبوعة:'}
          </label>
          {activeConfig.backgroundImage && activeConfig.backgroundImage.trim() !== '' ? (
            <div className="flex items-center justify-between gap-3 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3 overflow-hidden">
                <img
                  src={activeConfig.backgroundImage}
                  alt="Pad"
                  className="w-12 h-16 object-cover rounded-lg border border-slate-700 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-emerald-400 truncate">
                    {isEn ? 'Prescription image attached successfully' : 'تم إرفاق صورة الروشتة بنجاح'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {isEn ? 'Ready for calibration & printing' : 'جاهزة للضبط والطباعة'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRemoveImage}
                className="p-2 text-rose-400 hover:bg-rose-500/20 rounded-xl transition-all"
                title={isEn ? 'Remove Image' : 'حذف الصورة'}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl cursor-pointer bg-slate-950/50 hover:bg-slate-950 transition-all text-center group">
              <Upload className="h-6 w-6 text-slate-400 group-hover:text-indigo-400 mb-1 transition-colors" />
              <span className="text-xs font-bold text-slate-300 group-hover:text-white">
                {isEn ? 'Click to upload blank prescription pad image' : 'اضغط لرفع صورة ورقة الروشتة الخالية'}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5">
                {isEn ? 'Photo from camera or scanner (PNG, JPG)' : 'صورة من تصوير الموبايل أو السكانر (PNG, JPG)'}
              </span>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </label>
          )}
        </div>

        {/* Print Toggle */}
        <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/80 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200">
                {isEn ? 'Paper Print Behavior:' : 'سلوك الطباعة على الورق:'}
              </span>
              <button
                type="button"
                onClick={handleToggleHideOnPrint}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all ${
                  activeConfig.hideBackgroundOnPrint
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                }`}
              >
                {activeConfig.hideBackgroundOnPrint ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    <span>{isEn ? 'Hide Background on Print' : 'إخفاء الصورة عند الطباعة'}</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    <span>{isEn ? 'Print Full Background' : 'طباعة الصورة بالكامل'}</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 font-medium leading-relaxed mt-2">
              {activeConfig.hideBackgroundOnPrint
                ? (isEn
                    ? 'Active: When printing, only text and data will print over your pre-printed stationery paper.'
                    : 'مفعل: عند إرسال الأمر للطابعة، سيتم طباعة النصوص والبيانات فقط فوق ورق الروشتة المطبوع مسبقاً من المطبعة.')
                : (isEn
                    ? 'Inactive: The background image will be printed together with the data on blank white paper.'
                    : 'معطل: سيتم طباعة الصورة كخلفية كاملة مع البيانات على ورق أبيض فارغ.')}
            </p>
          </div>
        </div>
      </div>

      {/* Main Canvas + Control Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Interactive Canvas (Takes 7 columns) */}
        <div className="lg:col-span-7 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300 px-1">
            <span className="flex items-center gap-1">
              <Move className="h-3.5 w-3.5 text-indigo-400" />
              {isEn ? 'Drag with mouse to reposition elements:' : 'قم بالسحب بالماوس لتغيير مواضع الخانات:'}
            </span>
            <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded-full text-slate-400">
              {isEn ? 'Standard A4 Ratio' : 'نسبة A4 قياسية'}
            </span>
          </div>

          {/* Canvas Box */}
          <div
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleDragEnd}
            onTouchCancel={handleDragEnd}
            className="relative w-full aspect-[1/1.41] bg-slate-950 rounded-2xl border-2 border-slate-700 overflow-hidden shadow-2xl cursor-crosshair select-none touch-none"
          >
            {/* Background Image or Grid Placeholder */}
            {activeConfig.backgroundImage && activeConfig.backgroundImage.trim() !== '' ? (
              <img
                src={activeConfig.backgroundImage}
                alt="Pad Canvas"
                className="absolute inset-0 w-full h-full object-fill pointer-events-none opacity-90"
              />
            ) : (
              <div className="absolute inset-0 bg-slate-900/60 p-6 flex flex-col justify-between border border-slate-800/80 pointer-events-none">
                <div className="flex justify-between items-start text-slate-500 border-b border-slate-800 pb-3">
                  <div>
                    <p className="font-bold text-xs text-slate-400">{doctorName}</p>
                    <p className="text-[10px] text-slate-600">{clinicName}</p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-xs text-slate-400">Rx Prescription</p>
                  </div>
                </div>
                <div className="text-center text-slate-600 text-xs py-10 font-bold border border-dashed border-slate-800 rounded-xl">
                  {isEn ? '[ Blank prescription area - upload image above to preview here ]' : '[ مساحة الروشتة الخالية - ارفع صوّرتها بالأعلى لتراها هنا ]'}
                </div>
                <div className="border-t border-slate-800 pt-2 text-[10px] text-slate-600 text-center">
                  {isEn ? 'Pre-printed address & phone number' : 'العنوان ورقم الهاتف المطبوع مسبقاً'}
                </div>
              </div>
            )}

            {/* Draggable Elements Overlay */}
            {(['patientName', 'patientAge', 'date', 'medicationsBox', 'notesBox'] as ElementKey[]).map((key) => {
              const el = activeConfig[key];
              const info = ELEMENT_LABELS[key];
              const isSelected = selectedElement === key;
              const isBox = key === 'medicationsBox' || key === 'notesBox';

              return (
                <div
                  key={key}
                  onMouseDown={(e) => handleMouseDown(key, e)}
                  onTouchStart={(e) => handleMouseDown(key, e)}
                  style={{
                    position: 'absolute',
                    top: `${el.top}%`,
                    left: `${el.left}%`,
                    width: isBox ? `${el.width || 80}%` : 'auto',
                    height: isBox ? `${el.height || 20}%` : 'auto',
                    fontSize: `${el.fontSize || 14}px`,
                  }}
                  className={`cursor-move transition-shadow rounded-lg p-2 flex items-center justify-between gap-1.5 ${info.bg} ${info.color} ${
                    isSelected
                      ? 'ring-2 ring-indigo-500 shadow-xl border-2 border-indigo-600 z-30 font-black'
                      : `border border-dashed ${info.border} z-20 hover:ring-2 hover:ring-slate-400/50`
                  }`}
                >
                  <span className="font-black pointer-events-none text-xs truncate">
                    {getElementTitle(key, isEn)}
                  </span>
                  <Move className="h-3.5 w-3.5 shrink-0 opacity-80 pointer-events-none" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side Precision Numeric Sliders & Controls (Takes 5 columns) */}
        <div className="lg:col-span-5 space-y-4 bg-slate-800/90 p-5 rounded-2xl border border-slate-700">
          <div className="border-b border-slate-700 pb-3">
            <h4 className="text-xs font-black text-slate-200 flex items-center gap-1.5">
              <Type className="h-4 w-4 text-indigo-400" />
              {isEn ? 'Adjust Selected Element Dimensions & Position' : 'تعديل أبعاد ومواقع الخانات المحددة'}
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isEn ? 'Select element to fine-tune percentage position & font size:' : 'اختر الخانة لضبط موقعها بالنسبة المئوية وحجم خطها بدقة:'}
            </p>
          </div>

          {/* Element Tabs */}
          <div className="grid grid-cols-2 gap-1.5 bg-slate-900 p-1.5 rounded-xl border border-slate-700/80">
            {(['patientName', 'patientAge', 'date', 'medicationsBox', 'notesBox'] as ElementKey[]).map((key) => {
              const isSelected = selectedElement === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedElement(key)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-between ${
                    isEn ? 'text-left' : 'text-right'
                  } ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate">{getElementTitle(key, isEn)}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Active Element Controls */}
          <div className="space-y-4 pt-2">
            <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-indigo-300">
                  {getElementTitle(selectedElement, isEn)}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  top: {currentElConfig.top}%, left: {currentElConfig.left}%
                </span>
              </div>

              {/* Slider Top */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-slate-300">
                  <span>{isEn ? 'Top Position (Top %):' : 'الموقع من الأعلى (Top %):'}</span>
                  <span className="text-indigo-400">{currentElConfig.top}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="95"
                  value={currentElConfig.top}
                  onChange={(e) => updateElementConfig(selectedElement, { top: Number(e.target.value) })}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Slider Left */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-slate-300">
                  <span>{isEn ? 'Left Position (Left %):' : 'الموقع من اليسار (Left %):'}</span>
                  <span className="text-indigo-400">{currentElConfig.left}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="95"
                  value={currentElConfig.left}
                  onChange={(e) => updateElementConfig(selectedElement, { left: Number(e.target.value) })}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Slider Font Size */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-slate-300">
                  <span>{isEn ? 'Font Size:' : 'حجم الخط (Font Size):'}</span>
                  <span className="text-indigo-400 font-mono font-bold text-xs">{currentElConfig.fontSize || 14}px</span>
                </div>
                <input
                  type="range"
                  min="8"
                  max="48"
                  value={currentElConfig.fontSize || 14}
                  onChange={(e) => updateElementConfig(selectedElement, { fontSize: Number(e.target.value) })}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Width & Height controls for Boxes */}
              {(selectedElement === 'medicationsBox' || selectedElement === 'notesBox') && (
                <>
                  <div className="border-t border-slate-800 my-2 pt-2 space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-slate-300">
                        <span>{isEn ? 'Box Width (Width %):' : 'عرض المربع (Width %):'}</span>
                        <span className="text-indigo-400">{currentElConfig.width || 80}%</span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="100"
                        value={currentElConfig.width || 80}
                        onChange={(e) => updateElementConfig(selectedElement, { width: Number(e.target.value) })}
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-slate-300">
                        <span>{isEn ? 'Box Height (Height %):' : 'ارتفاع المربع (Height %):'}</span>
                        <span className="text-indigo-400">{currentElConfig.height || 20}%</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="80"
                        value={currentElConfig.height || 20}
                        onChange={(e) => updateElementConfig(selectedElement, { height: Number(e.target.value) })}
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Directional Nudge Pad (Arrow Keys & Buttons) */}
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-200">
                  <span>{isEn ? 'Arrow Keys Nudge Pad (Keyboard ⬆️ ⬇️ ⬅️ ➡️):' : 'التحكم الدقيق بالأسهم (الكيبورد ⬆️ ⬇️ ⬅️ ➡️):'}</span>
                  <span className="text-[10px] text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/60 font-mono">
                    {isEn ? 'Shift for 5% jump' : 'Shift للقفز السريع (5%)'}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-1 py-1 bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => nudgeElement(selectedElement, 'up', 1)}
                    className="p-2 bg-slate-800 hover:bg-indigo-600 active:bg-indigo-700 text-white rounded-lg transition border border-slate-700 shadow shrink-0 cursor-pointer"
                    title={isEn ? 'Move Up (ArrowUp)' : 'تحريك لأعلى (ArrowUp)'}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => nudgeElement(selectedElement, 'right', 1)}
                      className="p-2 bg-slate-800 hover:bg-indigo-600 active:bg-indigo-700 text-white rounded-lg transition border border-slate-700 shadow shrink-0 cursor-pointer"
                      title={isEn ? 'Move Right (ArrowRight)' : 'تحريك لليمين (ArrowRight)'}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <div className="text-[10px] text-indigo-300 font-mono px-1 text-center select-none font-bold">
                      {currentElConfig.top}% / {currentElConfig.left}%
                    </div>
                    <button
                      type="button"
                      onClick={() => nudgeElement(selectedElement, 'left', 1)}
                      className="p-2 bg-slate-800 hover:bg-indigo-600 active:bg-indigo-700 text-white rounded-lg transition border border-slate-700 shadow shrink-0 cursor-pointer"
                      title={isEn ? 'Move Left (ArrowLeft)' : 'تحريك لليسار (ArrowLeft)'}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => nudgeElement(selectedElement, 'down', 1)}
                    className="p-2 bg-slate-800 hover:bg-indigo-600 active:bg-indigo-700 text-white rounded-lg transition border border-slate-700 shadow shrink-0 cursor-pointer"
                    title={isEn ? 'Move Down (ArrowDown)' : 'تحريك لأسفل (ArrowDown)'}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
