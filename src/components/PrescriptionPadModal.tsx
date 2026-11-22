import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, RotateCcw, Move, Check, Trash2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { CustomPrescriptionPadConfig } from '../types';

type Key = 'patientName' | 'patientAge' | 'date' | 'medicationsBox' | 'notesBox';
const keys: Key[] = ['patientName', 'patientAge', 'date', 'medicationsBox', 'notesBox'];
const labels = { patientName: ['اسم المريض', 'Patient name'], patientAge: ['العمر', 'Age'], date: ['التاريخ', 'Date'], medicationsBox: ['مربع الأدوية', 'Medications box'], notesBox: ['مربع الملاحظات', 'Notes box'] };
interface Props {
  config: CustomPrescriptionPadConfig; isEn: boolean; onChange: (key: Key, change: Partial<CustomPrescriptionPadConfig[Key]>) => void;
  onClose: () => void; onReset: () => void; onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: () => void; onTogglePrint: () => void; uploading: boolean; saveStatus: 'saved' | 'saving' | 'error'; onRetry: () => void;
}
export default function PrescriptionPadModal({ config, isEn, onChange: commitChange, onClose, onReset, onUpload, onRemoveImage, onTogglePrint, uploading, saveStatus, onRetry }: Props) {
  const [selected, setSelected] = useState<Key>('patientName');
  const [drag, setDrag] = useState<{ key: Key; x: number; y: number; top: number; left: number; width: number; height: number; resize: boolean } | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const paper = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const text = (ar: string, en: string) => isEn ? en : ar;
  const title = (key: Key) => labels[key][isEn ? 1 : 0];
  const current = config[selected];
  const onChange = (key: Key, change: Partial<CustomPrescriptionPadConfig[Key]>) => {
    const field = paper.current?.querySelector<HTMLElement>(`[data-testid="pad-field-${key}"]`);
    const rect = paper.current?.getBoundingClientRect();
    if (field && rect) {
      const box = key.endsWith('Box');
      const ratio = change.fontSize && !box ? change.fontSize / (config[key].fontSize || 14) : 1;
      const width = change.width ?? (field.getBoundingClientRect().width / rect.width * 100 * ratio);
      const height = change.height ?? (field.getBoundingClientRect().height / rect.height * 100 * ratio);
      change = { ...change, left: Math.round(Math.max(0, Math.min(change.left ?? config[key].left, 100 - width)) * 10) / 10, top: Math.round(Math.max(0, Math.min(change.top ?? config[key].top, 100 - height)) * 10) / 10 };
    }
    commitChange(key, change);
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab') {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || [])].filter(el => el.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      const step = e.shiftKey ? 5 : 1;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (e.key === 'ArrowUp') onChange(selected, { top: Math.max(0, current.top - step) });
        if (e.key === 'ArrowDown') onChange(selected, { top: Math.min(95, current.top + step) });
        if (e.key === 'ArrowLeft') onChange(selected, { left: Math.max(0, current.left - step) });
        if (e.key === 'ArrowRight') onChange(selected, { left: Math.min(95, current.left + step) });
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [selected, current, onChange, onClose]);
  const start = (e: React.PointerEvent, key: Key, resize = false) => {
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(key); const c = config[key];
    setDrag({ key, x: e.clientX, y: e.clientY, top: c.top, left: c.left, width: c.width || 84, height: c.height || 20, resize });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag || !paper.current) return;
    const rect = paper.current.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / rect.width * 100, dy = (e.clientY - drag.y) / rect.height * 100;
    if (drag.resize) { onChange(drag.key, { width: Math.max(20, Math.min(100 - drag.left, drag.width + dx)), height: Math.max(10, Math.min(100 - drag.top, drag.height + dy)) }); return; }
    let left = Math.max(0, Math.min(95, drag.left + dx)), top = Math.max(0, Math.min(95, drag.top + dy));
    const xs = [7, 50, ...keys.filter(k => k !== drag.key).map(k => config[k].left)];
    const ys = [7, 50, ...keys.filter(k => k !== drag.key).map(k => config[k].top)];
    const x = xs.find(v => Math.abs(v - left) < 1), y = ys.find(v => Math.abs(v - top) < 1);
    if (x !== undefined) left = x; if (y !== undefined) top = y;
    setGuides({ x, y }); onChange(drag.key, { left: Math.round(left * 10) / 10, top: Math.round(top * 10) / 10 });
  };
  const end = () => { setDrag(null); setGuides({}); };
  const button = 'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-100';
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3" onClick={onClose} dir={isEn ? 'ltr' : 'rtl'}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pad-title" data-testid="pad-editor-modal" onClick={e => e.stopPropagation()} className="w-full max-w-[1060px] max-h-[94vh] overflow-auto rounded-[20px] bg-white shadow-2xl outline-none">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
        <h3 id="pad-title" className="font-black text-sm text-slate-800">🎨 {text('تصميم ورقتك الخاصة', 'Design your own pad')}</h3>
        <span className="text-[11px] text-emerald-700 bg-emerald-50 rounded-full px-3 py-1">{text('اسحب أي خانة على الورقة وخليها في مكانها', 'Drag any field into place')}</span>
        <div className="flex flex-wrap items-center gap-2 ms-auto">
          <button type="button" aria-pressed={config.hideBackgroundOnPrint} onClick={onTogglePrint} className="text-[10px] font-bold text-slate-500 flex gap-2 items-center"><span className={`w-7 h-4 rounded-full p-0.5 flex ${config.hideBackgroundOnPrint ? 'bg-emerald-500 justify-end' : 'bg-slate-300'}`}><span className="w-3 h-3 rounded-full bg-white" /></span>{text('إخفاء الخلفية عند الطباعة', 'Hide background on print')}</button>
          <label className={`${button} cursor-pointer text-emerald-700 bg-emerald-50`}><Upload size={13} />{uploading ? text('جاري الرفع...', 'Uploading...') : text('رفع صورة الورق', 'Upload pad image')}<input disabled={uploading} type="file" accept="image/*" className="hidden" onChange={onUpload} /></label>
          <button type="button" className={button} onClick={onReset} title={text('إعادة ضبط المواضع', 'Reset positions')}><RotateCcw size={14} /></button>
          <button type="button" className={`${button} text-rose-600 bg-rose-50`} onClick={onClose}><X size={14} />{text('إغلاق', 'Close')}</button>
        </div>
      </header>
      <div className="bg-slate-100 px-4 py-6 flex flex-col md:flex-row items-center md:items-start justify-center gap-5" dir="ltr">
        <div ref={paper} data-testid="pad-paper" className="relative bg-white shadow-xl rounded-sm shrink-0 touch-none select-none" style={{ width: 'min(420px, 85vw)', aspectRatio: '210 / 297' }} dir={isEn ? 'ltr' : 'rtl'}>
          {config.backgroundImage ? <><img alt={text('خلفية الروشتة', 'Prescription background')} src={config.backgroundImage} className="absolute inset-0 w-full h-full object-fill pointer-events-none opacity-40" /><button type="button" onClick={onRemoveImage} className="absolute -top-3 left-2 rounded-full bg-slate-600 text-white text-[9px] px-3 py-1 z-40 flex gap-2 items-center">{text('صورة الورق المرفوعة', 'Uploaded pad image')}<Trash2 size={11} /></button></> : <p className="absolute bottom-5 inset-x-4 text-center text-[11px] text-slate-300">{text('ارفع صورة ورقتك لتحديد مواضع الخانات عليها', 'Upload your pad image to position fields')}</p>}
          {drag && !drag.resize && <div className="absolute rounded-lg border-2 border-dotted border-slate-300 pointer-events-none" style={{ top: `${drag.top}%`, left: `${drag.left}%`, width: drag.key.endsWith('Box') ? `${drag.width}%` : 80, height: drag.key.endsWith('Box') ? `${drag.height}%` : 32 }} />}
          {guides.x !== undefined && <div data-testid="pad-guide-v" className="absolute inset-y-0 border-l border-dashed border-emerald-500 pointer-events-none z-30" style={{ left: `${guides.x}%` }} />}
          {guides.y !== undefined && <div data-testid="pad-guide-h" className="absolute inset-x-0 border-t border-dashed border-emerald-500 pointer-events-none z-30" style={{ top: `${guides.y}%` }} />}
          {keys.map(key => { const c = config[key], box = key.endsWith('Box'), active = selected === key; return <div key={key} data-testid={`pad-field-${key}`} tabIndex={0} role="button" aria-label={title(key)} onFocus={() => setSelected(key)} onPointerDown={e => start(e, key)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className={`absolute flex items-center justify-center gap-1 rounded-lg px-2 py-1 cursor-grab border-2 ${active ? 'border-emerald-500 bg-emerald-50/70 text-emerald-900 z-20 shadow-md outline-none' : 'border-dashed border-slate-400 bg-white/80 text-slate-600 z-10'}`} style={{ top: `${c.top}%`, left: `${c.left}%`, width: box ? `${c.width || 84}%` : 'auto', height: box ? `${c.height || 20}%` : 'auto', fontSize: `${c.fontSize || 14}px` }}><Move size={12} className="shrink-0" /><span>{title(key)}</span>{active && box && <span role="button" aria-label={text('تغيير حجم المربع', 'Resize box')} onPointerDown={e => start(e, key, true)} onPointerMove={move} onPointerUp={end} className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-emerald-500 rounded-sm cursor-se-resize" />}{drag?.key === key && <span className="absolute top-full mt-2 left-0 bg-slate-800 text-emerald-200 rounded-md px-2 py-1 text-[9px] whitespace-nowrap" dir="ltr">{c.top}% ↓ · {c.left}% →</span>}</div>; })}
        </div>
        <aside className="w-[228px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4" dir={isEn ? 'ltr' : 'rtl'}>
          <div><p className="text-[10px] text-slate-400">{text('الخانة المحددة', 'Selected field')}</p><p className="font-black text-sm text-slate-800">{title(selected)}</p></div>
          <label className="block text-[11px] font-bold text-slate-500">{text('حجم الخط', 'Font size')}<div className="flex items-center gap-2 mt-2"><span className="text-[9px]">A</span><input aria-label={text('حجم الخط', 'Font size')} type="range" min="8" max="48" value={current.fontSize || 14} onChange={e => onChange(selected, { fontSize: Number(e.target.value) })} className="min-w-0 w-full accent-emerald-600" /><span className="text-base">A</span><output>{current.fontSize || 14}</output></div></label>
          <div className="border-t border-slate-100 pt-3 space-y-3"><p className="text-[11px] font-bold text-slate-500">{text('تحكم دقيق', 'Fine positioning')}</p>{(['top', 'left'] as const).map(axis => <label key={axis} className="flex items-center gap-2 text-[10px] text-slate-500"><span className="w-14 shrink-0">{axis === 'top' ? text('من الأعلى', 'From top') : text('من اليسار', 'From left')}</span><input aria-label={axis} type="range" min="0" max="95" step="0.5" value={current[axis]} onChange={e => onChange(selected, { [axis]: Number(e.target.value) })} className="w-full min-w-0 accent-emerald-600" /><output className="w-8 shrink-0">{current[axis]}%</output></label>)}</div>
          <div className="border-t border-slate-100 pt-3"><p className="text-[10px] text-slate-400 mb-2">{text('حرّك بالماوس أو أسهم الكيبورد', 'Drag or use the arrow keys')}</p><div className="flex gap-1" dir="ltr">{([['left', ArrowLeft], ['up', ArrowUp], ['down', ArrowDown], ['right', ArrowRight]] as const).map(([direction, Icon]) => <button key={direction} type="button" aria-label={direction} className="p-1.5 border border-slate-200 rounded text-slate-500 hover:bg-emerald-50" onClick={() => onChange(selected, direction === 'up' || direction === 'down' ? { top: Math.max(0, Math.min(95, current.top + (direction === 'up' ? -1 : 1))) } : { left: Math.max(0, Math.min(95, current.left + (direction === 'left' ? -1 : 1))) })}><Icon size={14} /></button>)}</div><p className="text-[10px] text-slate-400 mt-2">Shift + ↑ ↓ ← → {text('للتحريك السريع', 'for faster movement')}</p></div>
          {selected.endsWith('Box') && <p className="text-[10px] text-slate-400">{text('اسحب مقبض الركن لتغيير أبعاد المربع', 'Drag the corner handle to resize the box')}</p>}
        </aside>
      </div>
      <footer className="flex justify-between items-center gap-3 px-5 py-3 border-t border-slate-200 text-[10px] text-slate-400"><span className="flex gap-1 items-center text-emerald-600 font-bold"><Check size={13} />{saveStatus === 'saving' ? text('جاري حفظ التغييرات...', 'Saving changes...') : saveStatus === 'error' ? text('محفوظ على هذا الجهاز فقط. أعد المحاولة', 'Saved on this device only. Retry') : text('التغييرات محفوظة تلقائياً', 'Changes saved automatically')}{saveStatus === 'error' && <button type="button" onClick={onRetry} className="underline">{text('إعادة المحاولة', 'Retry')}</button>}</span><span>{text('اسحب للتحريك · اضغط على الخانة لتحديدها', 'Drag to move · Click a field to select')}</span></footer>
    </div>
  </div>;
}
