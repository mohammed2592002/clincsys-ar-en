import { createPortal } from 'react-dom';
import { formatProcedureName } from '../utils/procedureLabels';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { collection, db, getDocs } from '../dbClient';
import { useOverdueLabOrders, overdueDays } from '../hooks/useOverdueLabOrders';
import { normalizeDateStr } from '../utils/timeUtils';
import { safeStorage } from '../utils/storage';

export default function OverdueLabPanel({ clinicId, onViewOrder, onOpenLabs }: {
  clinicId: string; onViewOrder: (id: string) => void; onOpenLabs: () => void;
}) {
  const { i18n } = useTranslation();
  const en = i18n.language.startsWith('en');
  const { overdue, today } = useOverdueLabOrders(clinicId);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, bottom: 0 });
  const openTooltip = (event: React.MouseEvent<HTMLButtonElement> | React.FocusEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltipPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 292)), bottom: window.innerHeight - rect.top + 8 });
    setShowTooltip(true);
  };
  useEffect(() => {
    const hide = () => setShowTooltip(false);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, []);
  const key = `lab_alerts_dismissed_${clinicId}`;
  const [dismissed, setDismissed] = useState(() => safeStorage.getItem(key));
  useEffect(() => {
    setDismissed(safeStorage.getItem(key));
    setExpanded(false);
    let alive = true;
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, 'clinics', clinicId, 'appointments'), true);
        if (alive) setAppointments(snap.docs.map((d: any) => ({ ...d.data(), id: d.id })));
      } catch (error) { console.error('Failed to load linked laboratory appointments', error); }
    };
    const sync = (e: Event) => { if ((e as CustomEvent).detail?.table === 'appointments') void load(); };
    const storage = (e: StorageEvent) => { if (e.key === key) setDismissed(e.newValue); };
    void load();
    window.addEventListener('clinic-sync', sync);
    window.addEventListener('storage', storage);
    return () => { alive = false; window.removeEventListener('clinic-sync', sync); window.removeEventListener('storage', storage); };
  }, [clinicId, key]);
  const byId = useMemo(() => new Map(appointments.map(a => [a.id, a])), [appointments]);
  const linkedDate = (o: typeof overdue[number]) => normalizeDateStr(byId.get(o.appointmentId)?.date || o.appointmentDate);
  const sorted = [...overdue].sort((a, b) => {
    const ad = linkedDate(a), bd = linkedDate(b);
    const aUpcoming = ad >= today, bUpcoming = bd >= today;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    return (aUpcoming ? ad.localeCompare(bd) : 0) || a.expectedDeliveryDate.localeCompare(b.expectedDeliveryDate) || a.id.localeCompare(b.id);
  });
  const formatDate = (date: string) => {
    if (!date) return '';
    const parsed = new Date(date + 'T12:00:00Z');
    return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(en ? 'en-GB' : 'ar-EG', { day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' });
  };
  const dismissText = en ? 'Hide for the rest of today. Shows again tomorrow if still overdue.' : 'إخفاء لباقي اليوم، ويظهر غدًا إذا استمر التأخير';
  if (!sorted.length || dismissed === today) return null;
  return (
    <section data-testid="overdue-lab-panel" aria-label={en ? 'Overdue lab orders' : 'طلبات معمل متأخرة'} dir={en ? 'ltr' : 'rtl'} className="relative mb-6 rounded-2xl border border-rose-200 border-s-4 border-s-rose-600 bg-white shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-t-xl border-b border-rose-100 bg-rose-50/60 p-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-rose-100 p-2 text-rose-600"><AlertTriangle className="h-5 w-5" /></span>
          <div><h2 className="flex items-center gap-2 text-base font-black text-rose-800">{en ? 'Overdue lab orders' : 'طلبات معمل متأخرة'} <span className="rounded-lg bg-rose-700 px-2 py-0.5 text-sm text-white">{sorted.length.toLocaleString(en ? 'en-GB' : 'ar-EG')}</span></h2><p className="mt-1 text-xs text-rose-600">{en ? 'Check lab work before the patient arrives' : 'راجع المعمل قبل حضور المريض'}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onOpenLabs} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 cursor-pointer">{en ? 'Open lab management →' : 'فتح إدارة المعامل ←'}</button>
          <button type="button" data-testid="dismiss-lab-alerts" aria-label={dismissText} title={dismissText} onMouseEnter={openTooltip} onMouseLeave={() => setShowTooltip(false)} onFocus={openTooltip} onBlur={() => setShowTooltip(false)} onClick={() => { safeStorage.setItem(key, today); setDismissed(today); }} className="group inline-flex items-center justify-center rounded-md bg-rose-600 p-2 text-white hover:bg-rose-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-1">
            <X className="h-4 w-4" strokeWidth={3} />
            {showTooltip && createPortal(<span data-testid="lab-dismiss-tooltip" role="tooltip" dir={en ? 'ltr' : 'rtl'} style={tooltipPosition} className="pointer-events-none fixed z-[1000] w-max max-w-[280px] rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-white shadow-lg">{dismissText}</span>, document.body)}
          </button>
        </div>
      </header>
      <div className="divide-y divide-slate-100">
        {(expanded ? sorted : sorted.slice(0, 3)).map(order => {
          const appointment = byId.get(order.appointmentId);
          const date = linkedDate(order);
          const days = overdueDays(order, today);
          return <article data-testid="overdue-lab-row" key={order.id} className="grid grid-cols-1 items-center gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,.8fr)_minmax(0,1fr)_auto] sm:gap-5">
            <div className="min-w-0"><h3 className="break-words text-sm font-black text-slate-800">{order.patientName}</h3><p className="mt-1 break-words text-xs text-slate-500">{order.workType}{order.toothNumbers ? ` · ${en ? 'Tooth' : 'سن'} ${order.toothNumbers}` : ''} · {order.laboratoryName}</p></div>
            <div className="sm:text-center"><span className="inline-block rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600">{en ? `${days} ${days === 1 ? 'day' : 'days'} late` : days === 1 ? 'متأخر يوم' : days === 2 ? 'متأخر يومين' : `متأخر ${days.toLocaleString('ar-EG')} ${days <= 10 ? 'أيام' : 'يوم'}`}</span><p className="mt-1 text-xs text-slate-500">{en ? 'Due: ' : 'كان الاستلام: '}{formatDate(normalizeDateStr(order.expectedDeliveryDate))}</p></div>
            <div className="sm:border-s sm:border-slate-100 sm:ps-4"><p className="text-[11px] text-slate-500">{en ? 'Linked appointment' : 'الموعد المرتبط'}</p><p className={`mt-1 text-xs font-bold ${date === today ? 'text-rose-600' : 'text-slate-600'}`}>{date ? `${date === today ? (en ? 'Today, ' : 'اليوم، ') : ''}${formatDate(date)}` : (en ? 'No linked appointment' : 'لا يوجد موعد مرتبط')}</p>{appointment && <p className="mt-1 text-[11px] text-slate-500">{appointment.turnNumber ? `${en ? 'Turn' : 'الدور'} ${appointment.turnNumber} · ` : ''}{formatProcedureName(appointment.treatmentType || appointment.procedure || appointment.time || '', en)}</p>}</div>
            <button type="button" onClick={() => onViewOrder(order.id)} className="justify-self-start rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer">{en ? 'View order →' : 'عرض الطلب ←'}</button>
          </article>;
        })}
      </div>
      {sorted.length > 3 && <footer className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs"><span className="text-slate-500">{en ? `Showing ${expanded ? sorted.length : 3} of ${sorted.length} · Nearest appointments first` : `عرض ${expanded ? sorted.length : 3} من ${sorted.length} طلبات · المواعيد الأقرب أولاً`}</span><button type="button" data-testid="expand-lab-alerts" onClick={() => setExpanded(v => !v)} className="font-bold text-emerald-700 hover:underline cursor-pointer">{expanded ? (en ? 'Show less ↑' : 'عرض أقل ↑') : (en ? `Show all overdue orders (${sorted.length}) ↓` : `عرض كل الطلبات المتأخرة (${sorted.length}) ↓`)}</button></footer>}
    </section>
  );
}
