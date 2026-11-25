// Per-language landing-page HTML for /, /ar and /en.
// The built index.html is the Arabic default; these variants swap the head
// metadata (title, description, canonical, hreflang, og/twitter, JSON-LD)
// and the pre-JS fallback text so each language path stands alone for Google.
const BASE = 'https://coredentsys.cloud';

const AR_TITLE = 'CoreDentSys | نظام إدارة عيادات الأسنان — إدارة عيادتك كلها من مكان واحد';
const AR_OG_TITLE = 'CoreDentSys | نظام إدارة عيادات الأسنان';
const AR_DESC = 'CoreDentSys نظام متكامل لإدارة عيادات ومراكز الأسنان: حجوزات بالدور أو بالوقت، ملفات مرضى كاملة، مخطط أسنان تفاعلي، أشعة، روشتات، مختبرات، حسابات وتقفيل يومي، وتقارير. يعمل أونلاين وأوفلاين، بالعربي والإنجليزي، ومن أي جهاز.';
const EN_TITLE = 'CoreDentSys | Dental Clinic Management System — your whole clinic in one place';
const EN_OG_TITLE = 'CoreDentSys | Dental Clinic Management System';
const EN_DESC = 'CoreDentSys is a complete management system for dental clinics: queue or timed appointments, full patient files, an interactive dental chart, x-rays, prescriptions, labs, accounts with daily closing, and reports. Works online and offline, in Arabic and English, from any device.';

const preJs = (lang: 'ar' | 'en') =>
  lang === 'en'
    ? `<main style="font-family:sans-serif;padding:2rem;text-align:center;direction:ltr"><h1>${EN_OG_TITLE}</h1><p>${EN_DESC}</p><p dir="rtl">${AR_DESC}</p></main>`
    : `<main style="font-family:sans-serif;padding:2rem;text-align:center;direction:rtl"><h1>${AR_OG_TITLE}</h1><p>${AR_DESC}</p><p dir="ltr">${EN_DESC}</p></main>`;

const hreflang = [
  `<link rel="alternate" hreflang="ar" href="${BASE}/ar" />`,
  `<link rel="alternate" hreflang="en" href="${BASE}/en" />`,
  `<link rel="alternate" hreflang="x-default" href="${BASE}/" />`,
].join('\n    ');

export type LandingVariant = 'root' | 'ar' | 'en';

export function renderLandingHtml(variant: LandingVariant, baseHtml: string): string {
  const lang = variant === 'en' ? 'en' : 'ar';
  const title = lang === 'en' ? EN_TITLE : AR_TITLE;
  const ogTitle = lang === 'en' ? EN_OG_TITLE : AR_OG_TITLE;
  const desc = lang === 'en' ? EN_DESC : AR_DESC;
  const canonical = variant === 'root' ? BASE + '/' : BASE + '/' + variant;
  const ogLocale = lang === 'en' ? 'en_US' : 'ar_EG';
  const ogLocaleAlt = lang === 'en' ? 'ar_EG' : 'en_US';
  let html = baseHtml;
  const swap = (from: string, to: string) => {
    if (!html.includes(from)) throw new Error('landing meta anchor missing: ' + from.slice(0, 60));
    html = html.split(from).join(to);
  };
  swap('<html lang="ar" dir="rtl">', `<html lang="${lang}" dir="${lang === 'en' ? 'ltr' : 'rtl'}">`);
  swap(`<title>${AR_TITLE}</title>`, `<title>${title}</title>`);
  swap(`<meta name="description" content="${AR_DESC}" />`, `<meta name="description" content="${desc}" />`);
  swap(
    `<link rel="canonical" href="${BASE}/" />`,
    `<link rel="canonical" href="${canonical}" />\n    ${hreflang}`,
  );
  swap(`<meta property="og:title" content="${AR_OG_TITLE}" />`, `<meta property="og:title" content="${ogTitle}" />`);
  swap(`<meta property="og:description" content="${AR_DESC}" />`, `<meta property="og:description" content="${desc}" />`);
  swap(`<meta property="og:url" content="${BASE}/" />`, `<meta property="og:url" content="${canonical}" />`);
  swap('<meta property="og:locale" content="ar_EG" />', `<meta property="og:locale" content="${ogLocale}" />`);
  swap('<meta property="og:locale:alternate" content="en_US" />', `<meta property="og:locale:alternate" content="${ogLocaleAlt}" />`);
  swap(`<meta name="twitter:title" content="${AR_OG_TITLE}" />`, `<meta name="twitter:title" content="${ogTitle}" />`);
  swap(`<meta name="twitter:description" content="${AR_DESC}" />`, `<meta name="twitter:description" content="${desc}" />`);
  swap(`"description": "${AR_DESC}",`, `"description": "${desc}",`);
  swap('<div id="root"></div>', `<div id="root">${preJs(lang)}</div>`);
  return html;
}
