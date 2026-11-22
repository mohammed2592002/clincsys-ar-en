import { useEffect, useMemo, useState } from 'react';
import { collection, db, getDocs } from '../dbClient';
import { LabOrder } from '../types/dental';
import { getEgyptTodayStr, normalizeDateStr } from '../utils/timeUtils';

// Calendar-day arithmetic avoids timezone and daylight-saving rounding errors.
export function overdueDays(order: Pick<LabOrder, 'status' | 'expectedDeliveryDate' | 'actualDeliveryDate'>, today: string): number {
  if (order.status !== 'sent' || order.actualDeliveryDate) return 0;
  const due = normalizeDateStr(order.expectedDeliveryDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due >= today) return 0;
  const days = (Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 86400000;
  return Number.isFinite(days) ? Math.max(0, days) : 0;
}

export function useOverdueLabOrders(clinicId: string) {
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [today, setToday] = useState(getEgyptTodayStr);
  useEffect(() => {
    let alive = true;
    let version = 0;
    setOrders([]);
    const load = async () => {
      const request = ++version;
      try {
        // Do not use the lab dashboard's 150-row limit: old unreceived orders still matter.
        const snap = await getDocs(collection(db, 'clinics', clinicId, 'lab_orders'), true);
        if (alive && request === version) setOrders(snap.docs.map((d: any) => ({ ...d.data(), id: d.id })));
      } catch (error) { console.error('Failed to refresh overdue laboratory orders', error); }
    };
    const sync = (e: Event) => {
      const { table } = (e as CustomEvent).detail || {};
      if (table === 'lab_orders' || !table) void load();
    };
    const refresh = () => { setToday(getEgyptTodayStr()); void load(); };
    void load();
    const clock = window.setInterval(() => setToday(getEgyptTodayStr()), 30000);
    window.addEventListener('clinic-sync', sync);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      alive = false;
      clearInterval(clock);
      window.removeEventListener('clinic-sync', sync);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [clinicId]);
  const overdue = useMemo(() => orders.filter(o => overdueDays(o, today) > 0), [orders, today]);
  return { overdue, today };
}
