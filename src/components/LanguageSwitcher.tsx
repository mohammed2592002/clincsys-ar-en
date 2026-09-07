import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';

interface LanguageSwitcherProps {
  variant?: 'compact' | 'pill' | 'header';
  className?: string;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant = 'pill', className = '' }) => {
  const { i18n, t } = useTranslation();
  const currentLang = i18n.language?.startsWith('en') ? 'en' : 'ar';

  const toggleLanguage = () => {
    const nextLang = currentLang === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  const setLanguage = (lang: 'ar' | 'en') => {
    i18n.changeLanguage(lang);
  };

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={toggleLanguage}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all border shadow-2xs cursor-pointer ${
          currentLang === 'en'
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
        } ${className}`}
        title={t('common.switchLanguage')}
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="font-sans uppercase">{currentLang === 'ar' ? 'EN' : 'عربي'}</span>
      </button>
    );
  }

  if (variant === 'header') {
    return (
      <button
        type="button"
        onClick={toggleLanguage}
        className={`inline-flex items-center gap-1.5 text-xs bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200/80 shadow-2xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer ${className}`}
        title={t('common.switchLanguage')}
      >
        <Globe className="h-3.5 w-3.5 text-blue-600" />
        <span className="font-semibold">{currentLang === 'ar' ? 'English' : 'العربية'}</span>
      </button>
    );
  }

  return (
    <div className={`inline-flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 shadow-2xs ${className}`}>
      <button
        type="button"
        onClick={() => setLanguage('ar')}
        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
          currentLang === 'ar'
            ? 'bg-white text-emerald-700 shadow-xs'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <span>العربية</span>
        {currentLang === 'ar' && <Check className="h-3 w-3 text-emerald-600" />}
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
          currentLang === 'en'
            ? 'bg-white text-indigo-700 shadow-xs'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <span>English</span>
        {currentLang === 'en' && <Check className="h-3 w-3 text-indigo-600" />}
      </button>
    </div>
  );
};

export default LanguageSwitcher;
