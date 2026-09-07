import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Patient } from '../types';
import { Search, X, User, ChevronDown } from 'lucide-react';

interface PatientSearchSelectProps {
  patients: Patient[];
  selectedPatientId: string;
  onSelectPatient: (patientId: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}

export default function PatientSearchSelect({
  patients,
  selectedPatientId,
  onSelectPatient,
  placeholder,
  className = '',
  required = false
}: PatientSearchSelectProps) {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const defaultPlaceholder = isEn ? 'Search patient by name or phone...' : 'ابحث باسم المريض أو رقم الهاتف...';
  const actualPlaceholder = placeholder || defaultPlaceholder;
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Synchronize initial value or when selection changes externally
  const selectedPatient = patients.find((p) => p.id === selectedPatientId);
  const selectedPatientName = selectedPatient ? selectedPatient.name : '';

  useEffect(() => {
    if (selectedPatientName) {
      setSearchQuery(selectedPatientName);
    } else {
      setSearchQuery('');
    }
  }, [selectedPatientId, selectedPatientName]);

  // Handle click outside to close the suggestions dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // Revert query to selected patient's name if we close without confirming a change
        if (selectedPatientName) {
          setSearchQuery(selectedPatientName);
        } else {
          setSearchQuery('');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectedPatientName]);

  // Filter patients based on query
  const queryClean = searchQuery.trim().toLowerCase();
  const shouldShowDropdown = isOpen;
  const isCurrentlySelected = selectedPatient && searchQuery === selectedPatient.name;
  const isSearchLengthReady = queryClean.length >= 3;

  const filteredPatients = shouldShowDropdown && (isCurrentlySelected || isSearchLengthReady)
    ? patients.filter((p) => {
        if (isCurrentlySelected) {
          return p.id === selectedPatient.id;
        }
        return (
          p.name.toLowerCase().includes(queryClean) ||
          p.phone.includes(queryClean)
        );
      }).slice(0, 15) // Show top 15 matches for speed and style
    : [];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setIsOpen(true);
    // If user clears the input, trigger deselecting
    if (e.target.value === '') {
      onSelectPatient('');
    }
  };

  const handleSelect = (patient: Patient) => {
    onSelectPatient(patient.id);
    setSearchQuery(patient.name);
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelectPatient('');
    setSearchQuery('');
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative font-sans ${isEn ? 'text-left' : 'text-right'} ${className}`} dir={isEn ? "ltr" : "rtl"}>
      <div className="relative">
        <input
          type="text"
          required={required && !selectedPatientId}
          placeholder={actualPlaceholder}
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          className={`w-full ${isEn ? 'pl-10 pr-10' : 'pl-10 pr-10'} py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white font-medium text-slate-800 transition`}
        />
        
        {/* Search Icon */}
        <div className={`absolute inset-y-0 ${isEn ? 'left-0 pl-3' : 'right-0 pr-3'} flex items-center pointer-events-none text-slate-400`}>
          <Search className="h-4 w-4" />
        </div>

        {/* Action button (Clear or Dropdown arrow) */}
        <div className={`absolute inset-y-0 ${isEn ? 'right-0 pr-2.5' : 'left-0 pl-2.5'} flex items-center gap-1`}>
          {searchQuery ? (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400 mr-1" />
          )}
        </div>
      </div>

      {/* Hidden input to hold the value for standard form submission validity */}
      <input
        type="hidden"
        required={required}
        value={selectedPatientId}
        name="patientId"
      />

      {/* Suggestion Dropdown */}
      {shouldShowDropdown && (
        <div className="absolute z-50 w-full mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto animate-fadeIn divide-y divide-slate-50">
          {!isCurrentlySelected && !isSearchLengthReady ? (
            <div className="px-4 py-6 text-center text-xs text-amber-600 font-bold flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              {isEn ? "Type 3 or more characters to search..." : "يرجى كتابة 3 أحرف أو أكثر للبدء بالبحث..."}
            </div>
          ) : filteredPatients.length > 0 ? (
            filteredPatients.map((p) => {
              const isSelected = p.id === selectedPatientId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className={`w-full px-4 py-3 flex items-center justify-between ${isEn ? 'text-left' : 'text-right'} hover:bg-emerald-50/50 transition cursor-pointer ${
                    isSelected ? 'bg-emerald-50 text-emerald-950 font-semibold' : 'text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`p-1.5 rounded-lg ${isSelected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                      <User className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-slate-900 truncate">{p.name}</span>
                      <span className="block text-[10px] text-slate-400 font-mono mt-0.5" dir="ltr">{p.phone}</span>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                      {isEn ? "Selected" : "محدد"}
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <div className="px-4 py-6 text-center text-xs text-slate-400 font-bold">
              {isEn ? "No matching patients found" : "لا توجد نتائج مطابقة لبحثك"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
