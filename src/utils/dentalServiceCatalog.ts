import type { Clinic, CustomDentalService } from '../types';

export const ORTHODONTIC_CATALOG_VERSION = 1;
export const orthodonticCategory = (isEn: boolean) => isEn ? 'Orthodontics & Aesthetics' : 'تقويم وتجميل الأسنان';

export function orthodonticServices(isEn: boolean): CustomDentalService[] {
  const names = isEn ? [
    'Specific Teeth Orthodontics', 'Full Orthodontic Braces (Both Arches)',
    'Metal Braces (Single Arch)', 'Clear Aligners (Invisalign)',
    'Orthodontic Adjustment Session', 'Debonding & Retainer Installation',
  ] : [
    'تقويم أسنان محددة', 'تركيب تقويم أسنان كامل (فكين)',
    'تركيب تقويم معدني علوي/سفلي', 'تقويم شفاف تجميلي (Invisalign)',
    'جلسة شد ومعايرة تقويم', 'فك وإزالة تقويم وتثبيت',
  ];
  return names.map((name, i) => ({
    id: `ortho-def-${i}`, name, price: [4000, 8000, 5000, 15000, 500, 1000][i],
    condition: i === 5 ? 'healthy' : 'ortho', category: orthodonticCategory(isEn),
  }));
}

export function defaultDentalCategories(isEn: boolean): string[] {
  return isEn ? [
    'Fillings & Endodontics', 'Extractions & Surgery', orthodonticCategory(true),
    'Crowns & Prosthetics', 'Implants & Bridges', 'Hygiene & Prevention', 'Pediatric Dentistry', 'General',
  ] : [
    'حشوات وعلاج عصب', 'خلع وجراحة', orthodonticCategory(false), 'تركيبات وتلبيسات',
    'زراعة وجسور', 'تنظيف وقاية وتجميل', 'طب أسنان الأطفال', 'عام',
  ];
}

// Preserve non-orthodontic chart defaults. The six canonical ortho services are seeded below.
export function defaultDentalServices(isEn: boolean): CustomDentalService[] {
  const categories = defaultDentalCategories(isEn);
  const names = isEn ? [
    'Cosmetic Composite Laser Filling', 'Full Root Canal Treatment (RCT)', 'Silver Amalgam Filling',
    'Ceramic / Inlay Cosmetic Filling', 'White Zirconia Crown', '24k Gold Crown', 'PFM Metal Crown',
    'Pediatric Pulpotomy / Root Canal', 'Surgical / Simple Extraction', 'Scaling & Root Planing',
    'Immediate Tooth Implant', '3-Unit Porcelain Bridge', 'Partial / Full Removable Denture',
  ] : [
    'حشو ليزر كومبوزيت تجميلي', 'حشو عصب كامل (RCT)', 'حشو أملجم فضي (Amalgam)',
    'حشو سيراميك / إينلاي تجميلي', 'تلبيسة زيركون بيضاء (Zirconia)', 'تلبيسة ذهبية (Gold Crown 24k)',
    'تلبيسة فضية معدنية (PFM Crown)', 'علاج عصب أطفال', 'خلع جراحي / عادي', 'تنظيف وتلميع الجذور',
    'زراعة ضرس فوري', 'جسر خزفي 3 وحدات', 'تركيبة متحركة جزئية / كاملة',
  ];
  const prices = [600, 1500, 500, 1200, 2500, 4000, 1800, 800, 700, 450, 7500, 4500, 3000];
  const conditions: CustomDentalService['condition'][] = ['filled', 'filled', 'filled', 'filled', 'crown', 'crown', 'crown', 'filled', 'missing', 'healthy', 'implant', 'bridge', 'denture'];
  const categoryIndexes = [0, 0, 0, 0, 3, 3, 3, 6, 1, 5, 4, 4, 3];
  return names.map((name, i) => ({ id: `default-service-${i + 1}`, name, price: prices[i], condition: conditions[i], category: categories[categoryIndexes[i]] }));
}

/** One-time additive upgrade. The durable version makes edits and deletions permanent. */
export function seedOrthodonticCatalog(clinic: Pick<Clinic, 'customDentalServices' | 'dentalServiceCategories' | 'orthodonticCatalogVersion'>, isEn: boolean) {
  if ((clinic.orthodonticCatalogVersion || 0) >= ORTHODONTIC_CATALOG_VERSION) {
    return {
      customDentalServices: clinic.customDentalServices ?? [],
      dentalServiceCategories: clinic.dentalServiceCategories ?? [],
      orthodonticCatalogVersion: clinic.orthodonticCatalogVersion!,
    };
  }
  const services = [...(clinic.customDentalServices ?? defaultDentalServices(isEn))];
  const categories = [...(clinic.dentalServiceCategories ?? defaultDentalCategories(isEn))];
  // Fix the old English preset category without changing prices, conditions or service names.
  for (let i = 0; i < services.length; i++) {
    if (services[i].category === 'Orthodontics & Cosmetic') {
      services[i] = { ...services[i], category: orthodonticCategory(true) };
    }
  }
  const normalizedCategories = [...new Set(categories.map(c => c === 'Orthodontics & Cosmetic' ? orthodonticCategory(true) : c))];
  const arabicPresets = orthodonticServices(false);
  const englishPresets = orthodonticServices(true);
  for (const [index, preset] of orthodonticServices(isEn).entries()) {
    const aliases = [arabicPresets[index].name, englishPresets[index].name];
    if (index === 1) aliases.push('تركيب تقويم أسنان (كامل/فكين)', 'Full Braces (Both Arches)');
    if (index === 2) aliases.push('Upper/Lower Metal Braces');
    if (!services.some(service => aliases.includes(service.name))) {
      let id = preset.id;
      while (services.some(service => service.id === id)) id += '-seed';
      services.push({ ...preset, id });
    }
  }
  // Include categories of retained exact-name overrides as well as newly seeded services.
  for (const category of [orthodonticCategory(isEn), ...services.map(s => s.category).filter((c): c is string => !!c)]) {
    if (!normalizedCategories.includes(category)) normalizedCategories.push(category);
  }
  return { customDentalServices: services, dentalServiceCategories: normalizedCategories, orthodonticCatalogVersion: ORTHODONTIC_CATALOG_VERSION };
}
