import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import arTranslation from './locales/ar.json';
import enTranslation from './locales/en.json';

const resources = {
  ar: {
    translation: arTranslation
  },
  en: {
    translation: enTranslation
  }
};

const updateHtmlDirection = (lng: string) => {
  const isEn = lng.startsWith('en');
  const dir = isEn ? 'ltr' : 'rtl';
  const lang = isEn ? 'en' : 'ar';
  
  if (typeof document !== 'undefined') {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'ar',
    supportedLngs: ['ar', 'en'],
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng'
    }
  });

// Apply initial direction
const initialLng = i18n.language || 'ar';
updateHtmlDirection(initialLng);

// Listen to language changes
i18n.on('languageChanged', (lng) => {
  updateHtmlDirection(lng);
});

export default i18n;
