import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronDown, Check, X } from 'lucide-react';

interface SearchableSelectProps {
  label?: string;
  placeholder?: string;
  options: string[];
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  required?: boolean;
  icon?: React.ReactNode;
  hint?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
  required = false,
  icon,
  hint
}) => {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const defaultPlaceholder = isEn ? 'Select or search...' : 'اختر من القائمة أو ابحث...';
  const displayPlaceholder = placeholder || defaultPlaceholder;
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = (options || []).filter(opt =>
    (opt ? String(opt) : '').toLowerCase().includes(searchTerm.trim().toLowerCase())
  );

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
  };

  return (
    <div className="relative" ref={containerRef} dir={isEn ? "ltr" : "rtl"}>
      {label && (
        <label className={`block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between ${isEn ? 'text-left' : 'text-right'}`}>
          <span>
            {label} {required && <span className="text-rose-500">*</span>}
          </span>
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[10px] text-slate-400 hover:text-rose-600 transition cursor-pointer"
            >
              {isEn ? 'Clear' : 'مسح الاختيار'}
            </button>
          )}
        </label>
      )}

      <div
        onClick={() => {
          if (!disabled) setIsOpen(prev => !prev);
        }}
        className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-xs font-semibold flex items-center justify-between gap-2 transition cursor-pointer select-none ${
          disabled
            ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
            : isOpen
            ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
            : 'border-slate-200 text-slate-800 hover:border-slate-300'
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-slate-400 shrink-0">{icon}</span>}
          <span className={`truncate ${value ? 'text-slate-800 font-bold' : 'text-slate-400'}`}>
            {value || displayPlaceholder}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-emerald-600' : ''
          }`}
        />
      </div>

      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}

      {isOpen && !disabled && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-fade-in max-h-60 flex flex-col">
          {/* Search Box */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10">
            <div className="relative">
              <Search className={`h-3.5 w-3.5 text-slate-400 absolute ${isEn ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2`} />
              <input
                type="text"
                autoFocus
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={isEn ? "Search here..." : "ابحث هنا..."}
                className={`w-full ${isEn ? 'pl-8 pr-3' : 'pr-8 pl-3'} py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none`}
                onClick={e => e.stopPropagation()}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setSearchTerm('');
                  }}
                  className={`absolute ${isEn ? 'right-2.5' : 'left-2.5'} top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div className="overflow-y-auto p-1.5 space-y-0.5 max-h-48 custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt, i) => {
                const isSelected = opt === value;
                return (
                  <div
                    key={i}
                    onClick={e => {
                      e.stopPropagation();
                      handleSelect(opt);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between cursor-pointer transition ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-800 font-bold'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{opt}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                  </div>
                );
              })
            ) : (
              <div className="p-3 text-center text-xs text-slate-400">
                {isEn ? `No results matching "${searchTerm}"` : `لا توجد نتائج مطابقة لـ "${searchTerm}"`}
                {searchTerm.trim() && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      handleSelect(searchTerm.trim());
                    }}
                    className="block w-full mt-2 text-emerald-600 hover:underline font-bold text-xs"
                  >
                    {isEn ? `Use "${searchTerm.trim()}" as custom value` : `استخدام "${searchTerm.trim()}" كإدخال مخصص`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
