import { normalizeDateStr } from './timeUtils';

// Payment.date is the accounting/shift day, which can differ from the day cash
// was collected when a shift stays open overnight (or for several days).
export function getPaymentCollectionDate(payment: any, appointmentDate?: string): string {
  const reconstructed = /^(pay_init_|pay_dup_)/.test(String(payment?.id || ''));
  if (!reconstructed && payment?.createdAt) {
    const timestamp = new Date(payment.createdAt);
    if (!Number.isNaN(timestamp.getTime())) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(timestamp);
      const part = (type: string) => parts.find(p => p.type === type)?.value || '';
      return `${part('year')}-${part('month')}-${part('day')}`;
    }
  }
  // Legacy/reconstructed initial payments have no trustworthy receipt timestamp.
  return normalizeDateStr(payment?.date || appointmentDate);
}
