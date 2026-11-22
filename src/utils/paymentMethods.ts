// Payment-channel identity is shared by the UI and finance API. Only exact
// legacy aliases are normalized: a custom name containing "cash" is not cash.
export const DEFAULT_PAYMENT_METHODS = ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
export const UNSPECIFIED_PAYMENT_METHOD = 'غير محدد';
const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[ً-ٟ]/g, '');
const aliases: Record<string, string> = Object.create(null);
for (const [canonical, names] of [
  ['كاش', ['كاش', 'cash', 'نقد', 'نقدي', 'نقدا']],
  ['فيزا', ['فيزا', 'visa', 'card', 'بطاقة', 'بطاقه', 'كارت']],
  ['إنستاباي', ['إنستاباي', 'انستاباي', 'انستا باي', 'instapay', 'insta pay']],
  ['محفظة', ['محفظة', 'محفظه', 'wallet', 'e-wallet']],
  ['نقاط الولاء', ['نقاط الولاء', 'نقاط', 'نقط', 'loyalty', 'loyalty points', 'points']],
] as [string, string[]][]) for (const name of names) aliases[nameKey(name)] = canonical;

export function normalizePaymentMethod(value?: string | null): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return name ? aliases[nameKey(name)] || name : UNSPECIFIED_PAYMENT_METHOD;
}
export const paymentMethodKey = (value?: string | null) => nameKey(normalizePaymentMethod(value));
export const samePaymentMethod = (a?: string | null, b?: string | null) => paymentMethodKey(a) === paymentMethodKey(b);
export function getClinicPaymentMethods(configured?: string[] | null): string[] {
  // The fallback is only for pre-settings clinics. An explicit [] stays empty.
  const source = configured == null ? DEFAULT_PAYMENT_METHODS : Array.isArray(configured) ? configured : [];
  const found = new Set<string>();
  return source.filter(x => typeof x === 'string' && x.trim()).map(normalizePaymentMethod).filter(name => {
    const key = paymentMethodKey(name);
    if (name === 'نقاط الولاء' || found.has(key)) return false;
    found.add(key); return true;
  });
}
export function paymentMethodLabel(value: string | undefined | null, english = false): string {
  const name = normalizePaymentMethod(value);
  return english ? ({'كاش':'Cash','فيزا':'Visa / Card','إنستاباي':'InstaPay','محفظة':'E-Wallet','نقاط الولاء':'Loyalty Points','غير محدد':'Unspecified'}[name] || name) : name;
}
export function paymentMethodHistoryHasAmount(record: any, target: string): boolean {
  if (!record || typeof record !== 'object') return false;
  if (Array.isArray(record)) return record.some(value => paymentMethodHistoryHasAmount(value, target));
  const nonzero = (value: any) => Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0;
  if (record.paymentMethod && samePaymentMethod(record.paymentMethod, target) &&
      ['amount','amountCents','paidAmount','paid','paymentAmount','refundAmount'].some(k => nonzero(record[k]))) return true;
  for (const mapName of ['dynamicRevenues','dynamicExpenses','revenuesMap','expensesMap']) {
    const map = record[mapName];
    if (map && Object.entries(map).some(([key, value]) => samePaymentMethod(key, target) && nonzero(value))) return true;
  }
  const legacyFields: Record<string, string[]> = {
    'كاش':['cashRevenue','cashAmount','cashExpenses','startCash','actualCash'],
    'فيزا':['cardRevenue','cardAmount'], 'إنستاباي':['instapayRevenue','instapayAmount'],
    'محفظة':['walletRevenue','walletAmount'],
  };
  if ((legacyFields[normalizePaymentMethod(target)] || []).some(k => nonzero(record[k]))) return true;
  if (record.paymentMethod && samePaymentMethod(record.paymentMethod, target) &&
      /^(paid|partially paid)$/i.test(record.status || '') && nonzero(record.grandTotal)) return true;
  return Object.values(record).some(value => value && typeof value === 'object' && paymentMethodHistoryHasAmount(value, target));
}

export function getPaymentReportMethods(configured: string[] | undefined | null, ...maps: Record<string, number>[]): string[] {
  const names = getClinicPaymentMethods(configured);
  for (const map of maps) for (const [name, amount] of Object.entries(map || {})) {
    const channel = normalizePaymentMethod(name);
    if (Number(amount) !== 0 && channel !== 'نقاط الولاء' && !names.some(x => samePaymentMethod(x, channel))) names.push(channel);
  }
  return names;
}

// Channel identity is case-insensitive, but the configured display name is kept.
export function paymentMethodForReport(value: string | undefined | null, configured: string[] | undefined | null): string {
  const normalized=normalizePaymentMethod(value);
  return getClinicPaymentMethods(configured).find(name => samePaymentMethod(name,normalized)) || normalized;
}
export function paymentMethodMapAmount(map: Record<string,number> | undefined | null, name: string): number {
  return Object.entries(map || {}).reduce((sum,[key,value]) => sum + (samePaymentMethod(key,name) ? Math.round(Number(value || 0)*100) : 0),0)/100;
}
