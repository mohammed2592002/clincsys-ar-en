import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { DentalTooth, CustomDentalService, DentalToothHistoryItem, DentalChartStyleSettings, DEFAULT_DENTAL_CHART_SETTINGS } from '../types';
import { ShieldCheck, Info, Sparkles, Check, FlameKindling, Hammer, Heart, Eye, Settings, Plus, Edit2, Trash2, X, AlertCircle, Stethoscope, Receipt, Tag, History, Clock } from 'lucide-react';
import { useDialogs } from './DialogContext';
import { safeStorage } from '../utils/storage';
import { convertToFDI } from '../utils';

interface DentalChartProps {
  key?: React.Key;
  patientId?: string;
  initialChart?: { [toothNumber: number]: DentalTooth };
  onSaveChart: (chart: { [toothNumber: number]: DentalTooth }) => void;
  readOnly?: boolean;
  onSaveToothSession?: (toothNum: number, condition: DentalTooth['condition'], serviceName: string, price: number, notes: string, latestChart?: { [toothNumber: number]: DentalTooth }) => Promise<void>;
  clinicId?: string;
  customServices?: CustomDentalService[];
  onUpdateCustomServices?: (services: CustomDentalService[]) => Promise<void>;
  categories?: string[];
  onUpdateCategories?: (categories: string[]) => Promise<void>;
  patientAppointments?: any[];
  patientRecords?: any[];
}

// Tooth Classification Helpers
const getToothType = (num: number): 'molar' | 'premolar' | 'canine' | 'incisor' => {
  if (num >= 101 && num <= 120) {
    // Child teeth (Deciduous):
    // A, B, I, J, K, L, S, T are Molars (101, 102, 109, 110, 111, 112, 119, 120)
    // C, H, M, R are Canines (103, 108, 113, 118)
    // D, E, F, G, N, O, P, Q are Incisors (104, 105, 106, 107, 114, 115, 116, 117)
    const childMolarNums = [101, 102, 109, 110, 111, 112, 119, 120];
    const childCanineNums = [103, 108, 113, 118];
    if (childMolarNums.includes(num)) return 'molar';
    if (childCanineNums.includes(num)) return 'canine';
    return 'incisor';
  }
  // Upper: 1-3 Molar, 4-5 Premolar, 6 Canine, 7-10 Incisor, 11 Canine, 12-13 Premolar, 14-16 Molar
  // Lower: 17-19 Molar, 20-21 Premolar, 22 Canine, 23-26 Incisor, 27 Canine, 28-29 Premolar, 30-32 Molar
  if ([1, 2, 3, 14, 15, 16, 17, 18, 19, 30, 31, 32].includes(num)) return 'molar';
  if ([4, 5, 12, 13, 20, 21, 28, 29].includes(num)) return 'premolar';
  if ([6, 11, 22, 27].includes(num)) return 'canine';
  return 'incisor';
};


const getToothName = (num: number, isEn: boolean = false): string => {
  const isChild = num >= 101 && num <= 120;
  const type = getToothType(num);
  if (isEn) {
    const sideUpper = isChild ? (num <= 110 ? 'Primary Upper' : 'Primary Lower') : (num <= 16 ? 'Upper' : 'Lower');
    switch (type) {
      case 'molar': return `${sideUpper} Molar`;
      case 'premolar': return `${sideUpper} Premolar`;
      case 'canine': return `${sideUpper} Canine`;
      case 'incisor': return `${sideUpper} Incisor`;
    }
  }
  const sideUpper = isChild ? (num <= 110 ? 'علوي لبني' : 'سفلي لبني') : (num <= 16 ? 'علوي' : 'سفلي');
  switch (type) {
    case 'molar': return `ضرس ${sideUpper}`;
    case 'premolar': return `ضاحك ${sideUpper}`;
    case 'canine': return `ناب ${sideUpper}`;
    case 'incisor': return `قاطع ${sideUpper}`;
  }
};
const getToothArabicName = getToothName;

const getToothTypeName = (type: 'molar' | 'premolar' | 'canine' | 'incisor', isEn: boolean = false): string => {
  if (isEn) {
    switch (type) {
      case 'molar': return 'Molar';
      case 'premolar': return 'Premolar';
      case 'canine': return 'Canine';
      case 'incisor': return 'Incisor';
    }
  }
  switch (type) {
    case 'molar': return 'ضرس (Molar)';
    case 'premolar': return 'ضاحك (Premolar)';
    case 'canine': return 'ناب (Canine)';
    case 'incisor': return 'قاطع (Incisor)';
  }
};
const getToothTypeNameArabic = getToothTypeName;

interface ToothSystemInfo {
  universal: string;
  palmer: string;
  palmerSymbol: string;
  fdi: string;
}

const getAdultCoordinates = (num: number): { x: number; y: number } => {
  const coords: { [key: number]: { x: number; y: number } } = {
    1: { x: 14, y: 42 },
    2: { x: 17, y: 35 },
    3: { x: 20, y: 28 },
    4: { x: 24, y: 21 },
    5: { x: 29, y: 15 },
    6: { x: 34, y: 10 },
    7: { x: 40, y: 7 },
    8: { x: 46, y: 6 },
    9: { x: 54, y: 6 },
    10: { x: 60, y: 7 },
    11: { x: 66, y: 10 },
    12: { x: 71, y: 15 },
    13: { x: 76, y: 21 },
    14: { x: 80, y: 28 },
    15: { x: 83, y: 35 },
    16: { x: 86, y: 42 },
    17: { x: 86, y: 56 },
    18: { x: 83, y: 63 },
    19: { x: 80, y: 70 },
    20: { x: 76, y: 77 },
    21: { x: 71, y: 83 },
    22: { x: 66, y: 88 },
    23: { x: 60, y: 91 },
    24: { x: 54, y: 92 },
    25: { x: 46, y: 92 },
    26: { x: 40, y: 91 },
    27: { x: 34, y: 88 },
    28: { x: 29, y: 83 },
    29: { x: 24, y: 77 },
    30: { x: 20, y: 70 },
    31: { x: 17, y: 63 },
    32: { x: 14, y: 56 },
  };
  const raw = coords[num] || { x: 50, y: 50 };
  const scaleX = 1.05;
  const scaleY = 0.94;
  const x = 50 + (raw.x - 50) * scaleX;
  const y = 50 + (raw.y - 50) * scaleY;
  return { x, y };
};

const getChildCoordinates = (num: number): { x: number; y: number } => {
  const coords: { [key: number]: { x: number; y: number } } = {
    101: { x: 20, y: 33 },
    102: { x: 25, y: 26 },
    103: { x: 31, y: 20 },
    104: { x: 38, y: 16 },
    105: { x: 45, y: 14 },
    106: { x: 55, y: 14 },
    107: { x: 62, y: 16 },
    108: { x: 69, y: 20 },
    109: { x: 75, y: 26 },
    110: { x: 80, y: 33 },
    111: { x: 80, y: 65 },
    112: { x: 75, y: 72 },
    113: { x: 69, y: 78 },
    114: { x: 62, y: 82 },
    115: { x: 55, y: 84 },
    116: { x: 45, y: 84 },
    117: { x: 38, y: 82 },
    118: { x: 31, y: 78 },
    119: { x: 25, y: 72 },
    120: { x: 20, y: 65 },
  };
  const raw = coords[num] || { x: 50, y: 50 };
  const scaleX = 1.05;
  const scaleY = 0.94;
  const x = 50 + (raw.x - 50) * scaleX;
  const y = 50 + (raw.y - 50) * scaleY;
  return { x, y };
};

const getToothSystems = (num: number): ToothSystemInfo => {
  if (num >= 1 && num <= 32) {
    let universal = num.toString();
    let fdi = '';
    let palmer = '';
    let palmerSymbol = '';

    if (num >= 1 && num <= 8) {
      fdi = (19 - num).toString();
      palmer = (9 - num).toString();
      palmerSymbol = 'border-b border-r border-emerald-500 pr-1 pb-1';
    } else if (num >= 9 && num <= 16) {
      fdi = (num + 12).toString();
      palmer = (num - 8).toString();
      palmerSymbol = 'border-b border-l border-emerald-500 pl-1 pb-1';
    } else if (num >= 17 && num <= 24) {
      fdi = (55 - num).toString();
      palmer = (25 - num).toString();
      palmerSymbol = 'border-t border-l border-emerald-500 pl-1 pt-1';
    } else {
      fdi = (num + 16).toString();
      palmer = (num - 24).toString();
      palmerSymbol = 'border-t border-r border-emerald-500 pr-1 pt-1';
    }

    return { universal, palmer, palmerSymbol, fdi };
  }

  const childLetters = "ABCDEFGHIJKLMNOPQRST";
  let universal = childLetters[num - 101] || '';
  let fdi = '';
  let palmer = '';
  let palmerSymbol = '';

  if (num >= 101 && num <= 105) {
    fdi = (56 - (num - 100)).toString();
    palmer = String.fromCharCode(65 + (105 - num));
    palmerSymbol = 'border-b border-r border-emerald-500 pr-1 pb-1';
  } else if (num >= 106 && num <= 110) {
    fdi = (61 + (num - 106)).toString();
    palmer = String.fromCharCode(65 + (num - 106));
    palmerSymbol = 'border-b border-l border-emerald-500 pl-1 pb-1';
  } else if (num >= 111 && num <= 115) {
    fdi = (71 + (num - 111)).toString();
    palmer = String.fromCharCode(65 + (num - 111));
    palmerSymbol = 'border-t border-l border-emerald-500 pl-1 pt-1';
  } else {
    fdi = (81 + (120 - num)).toString();
    palmer = String.fromCharCode(65 + (120 - num));
    palmerSymbol = 'border-t border-r border-emerald-500 pr-1 pt-1';
  }

  return { universal, palmer, palmerSymbol, fdi };
};

const getToothLetter = (num: number): string => {
  const isChild = num >= 101 && num <= 120;
  const sys = getToothSystems(num);
  return isChild ? sys.palmer : sys.fdi;
};

export interface ToothSvgProps {
  num: number;
  condition?: DentalTooth['condition'];
  isEditing?: boolean;
  isUpper?: boolean;
  tooth?: DentalTooth;
  chartSettings?: DentalChartStyleSettings;
}

export type SpecificProcedureType =
  | 'healthy'
  | 'decayed'
  | 'rct'              // حشو عصب
  | 'composite'        // حشو تجميلي عادي
  | 'amalgam'          // حشو أملجم فضي
  | 'ceramic_filling'  // حشو سيراميك
  | 'gold_crown'       // تلبيسة ذهبية
  | 'silver_crown'     // تلبيسة فضية معدنية
  | 'white_crown'      // تلبيسة بيضاء / زيركون
  | 'bridge'           // جسر ثابت
  | 'denture'          // تركيبة متحركة
  | 'implant'          // زراعة
  | 'missing'          // خلع / مفقود
  | 'ortho';           // تقويم

export const getToothProcedureType = (
  condition?: DentalTooth['condition'],
  tooth?: DentalTooth
): SpecificProcedureType => {
  const cond = condition !== undefined ? condition : (tooth?.condition || 'healthy');
  if (cond === 'healthy') {
    return 'healthy';
  }

  const notesText = (tooth?.notes || '').toLowerCase();
  const historyText = tooth?.history ? tooth.history.map(h => `${h.serviceName || ''} ${h.notes || ''}`).join(' ').toLowerCase() : '';
  const text = `${notesText} ${historyText}`;

  if (cond === 'filled' || text.includes('حشو') || text.includes('عصب') || text.includes('rct') || text.includes('endo') || text.includes('أملجم') || text.includes('سيراميك') || text.includes('املجم')) {
    if (text.includes('عصب') || text.includes('rct') || text.includes('endo') || text.includes('جذور') || text.includes('سحب')) {
      return 'rct';
    }
    if (text.includes('أملجم') || text.includes('املجم') || text.includes('فضي') || text.includes('فضة') || text.includes('amalgam') || text.includes('silver')) {
      return 'amalgam';
    }
    if (text.includes('سيراميك') || text.includes('ايناي') || text.includes('ايناين') || text.includes('اونلاي') || text.includes('inlay') || text.includes('onlay') || text.includes('بورسلين')) {
      return 'ceramic_filling';
    }
    if (cond === 'filled') {
      return 'composite';
    }
  }

  if (cond === 'crown' || text.includes('تلبيس') || text.includes('طربوش') || text.includes('crown') || text.includes('زيركون')) {
    if (text.includes('ذهب') || text.includes('ذهبي') || text.includes('ذهبية') || text.includes('gold')) {
      return 'gold_crown';
    }
    if (text.includes('فضة') || text.includes('فضي') || text.includes('فضية') || text.includes('معدن') || text.includes('معدني') || text.includes('pfm') || text.includes('metal') || text.includes('silver')) {
      return 'silver_crown';
    }
    return 'white_crown';
  }

  if (cond === 'bridge') return 'bridge';
  if (cond === 'denture') return 'denture';
  if (cond === 'implant') return 'implant';
  if (cond === 'missing') return 'missing';
  if (cond === 'decayed') return 'decayed';
  if (cond === 'ortho') return 'ortho';

  return 'healthy';
};

export function ToothSvg({ num, condition = 'healthy', isEditing = false, isUpper = true, tooth, chartSettings }: ToothSvgProps) {
  const type = getToothType(num);
  const procType = getToothProcedureType(condition, tooth);
  
  const drawStyle = chartSettings?.drawingStyle || 'realistic_3d';
  const showRootCanals = chartSettings?.showRootCanals ?? true;

  // Decide Crown Fill & Stroke
  let crownFill = 'url(#healthy-crown-gradient)';
  let crownStroke = '#94a3b8';
  let crownStrokeWidth = drawStyle === 'high_contrast' ? '2.5' : '1.5';
  
  if (drawStyle === 'flat_minimal') {
    crownFill = '#ffffff';
  }

  if (procType === 'gold_crown') {
    crownFill = drawStyle === 'flat_minimal' ? (chartSettings?.goldCrownColor || '#d97706') : 'url(#gold-gradient)';
    crownStroke = chartSettings?.goldCrownColor || '#b45309';
    crownStrokeWidth = '1.8';
  } else if (procType === 'silver_crown') {
    crownFill = drawStyle === 'flat_minimal' ? (chartSettings?.silverCrownColor || '#475569') : 'url(#silver-metallic-gradient)';
    crownStroke = chartSettings?.silverCrownColor || '#334155';
    crownStrokeWidth = '1.8';
  } else if (procType === 'white_crown') {
    crownFill = drawStyle === 'flat_minimal' ? '#ffffff' : 'url(#zirconia-white-gradient)';
    crownStroke = chartSettings?.zirconiaCrownColor || '#0284c7';
    crownStrokeWidth = '1.8';
  } else if (procType === 'rct') {
    crownFill = drawStyle === 'flat_minimal' ? '#ffffff' : 'url(#healthy-crown-gradient)';
    crownStroke = chartSettings?.rctColor || '#be123c';
    crownStrokeWidth = '1.8';
  } else if (procType === 'composite') {
    crownFill = drawStyle === 'flat_minimal' ? '#f0fdf4' : 'url(#healthy-crown-gradient)';
    crownStroke = chartSettings?.compositeColor || '#0d9488';
    crownStrokeWidth = '1.5';
  } else if (procType === 'amalgam') {
    crownFill = drawStyle === 'flat_minimal' ? '#f1f5f9' : 'url(#healthy-crown-gradient)';
    crownStroke = chartSettings?.amalgamColor || '#334155';
    crownStrokeWidth = '1.8';
  } else if (procType === 'ceramic_filling') {
    crownFill = drawStyle === 'flat_minimal' ? '#f0f9ff' : 'url(#healthy-crown-gradient)';
    crownStroke = chartSettings?.ceramicFillingColor || '#0284c7';
    crownStrokeWidth = '1.5';
  } else if (condition === 'decayed') {
    crownFill = '#fee2e2';
    crownStroke = chartSettings?.decayColor || '#ef4444';
  } else if (condition === 'implant') {
    crownFill = '#ffffff';
    crownStroke = '#475569';
  } else if (condition === 'missing') {
    crownFill = 'none';
    crownStroke = '#475569';
    crownStrokeWidth = '1';
  } else if (condition === 'bridge') {
    crownFill = drawStyle === 'flat_minimal' ? '#e0e7ff' : 'url(#bridge-gradient)';
    crownStroke = '#3730a3';
    crownStrokeWidth = '1.8';
  } else if (condition === 'denture') {
    crownFill = drawStyle === 'flat_minimal' ? '#f8fafc' : 'url(#healthy-crown-gradient)';
    crownStroke = '#94a3b8';
    crownStrokeWidth = '1.5';
  } else if (condition === 'ortho') {
    crownFill = '#f0f9ff';
    crownStroke = '#0284c7';
  }

  // Decide Root Fill & Stroke
  let rootFill = drawStyle === 'flat_minimal' ? '#f1f5f9' : 'url(#healthy-root-gradient)';
  let rootStroke = '#cbd5e1';
  let rootStrokeWidth = drawStyle === 'high_contrast' ? '2.5' : '1.5';

  if (procType === 'rct') {
    rootFill = drawStyle === 'flat_minimal' ? '#f8fafc' : 'url(#healthy-root-gradient)';
    rootStroke = chartSettings?.rctColor || '#e11d48';
    rootStrokeWidth = '1.8';
  } else if (condition === 'implant') {
    rootFill = drawStyle === 'flat_minimal' ? '#94a3b8' : 'url(#silver-gradient)';
    rootStroke = '#334155';
  } else if (condition === 'missing') {
    rootFill = 'none';
    rootStroke = '#475569';
    rootStrokeWidth = '1';
  } else if (condition === 'decayed') {
    rootFill = drawStyle === 'flat_minimal' ? '#fef2f2' : 'url(#healthy-root-gradient)';
    rootStroke = chartSettings?.decayColor || '#ef4444';
  } else if (condition === 'bridge') {
    rootFill = drawStyle === 'flat_minimal' ? '#e0e7ff' : 'url(#healthy-root-gradient)';
    rootStroke = '#4338ca';
  } else if (condition === 'denture') {
    rootFill = drawStyle === 'flat_minimal' ? '#f8fafc' : 'url(#healthy-root-gradient)';
    rootStroke = '#94a3b8';
  }

  // Choose the base paths based on tooth type
  let crownPath = '';
  let rootPath = '';

  if (type === 'incisor') {
    crownPath = 'M 20 45 C 18 60, 16 75, 16 83 L 44 83 C 44 75, 42 60, 40 45 Z';
    rootPath = 'M 22 45 L 28 8 C 29 6, 31 6, 32 8 L 38 45 Z';
  } else if (type === 'canine') {
    crownPath = 'M 20 45 C 18 60, 17 72, 30 86 C 43 72, 42 60, 40 45 Z';
    rootPath = 'M 21 45 L 28 5 C 29 3, 31 3, 32 5 L 39 45 Z';
  } else if (type === 'premolar') {
    crownPath = 'M 18 45 C 16 60, 15 75, 22 83 C 25 85, 28 80, 30 80 C 32 80, 35 85, 38 83 C 45 75, 44 60, 42 45 Z';
    rootPath = 'M 20 45 L 24 12 C 25 10, 27 10, 28 20 L 30 20 L 32 20 C 33 10, 35 10, 36 12 L 40 45 Z';
  } else { // molar
    crownPath = 'M 14 45 C 12 60, 10 75, 18 85 C 22 87, 26 82, 30 82 C 34 82, 38 87, 42 85 C 50 75, 48 60, 46 45 Z';
    rootPath = 'M 16 45 L 12 10 C 11 8, 17 8, 19 22 L 30 35 L 41 22 C 43 8, 49 8, 48 10 L 44 45 Z';
  }

  const isMissing = condition === 'missing';
  const isChild = num >= 101 && num <= 120;
  
  return (
    <svg 
      viewBox="0 0 60 90" 
      className={`w-full h-full transition-transform duration-300 ${!isUpper ? 'rotate-180' : ''}`}
    >
      <g transform={isChild ? "translate(6, 9) scale(0.8)" : undefined}>
        {/* Root Rendering */}
        {condition === 'implant' ? (
          // Screw Implant Shape
          <g>
            <path d="M 22 45 L 26 15 C 27 12, 33 12, 34 15 L 38 45 Z" fill="url(#silver-gradient)" stroke="#334155" strokeWidth="1.5" />
            <line x1="23" y1="40" x2="37" y2="40" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" />
            <line x1="24" y1="34" x2="36" y2="34" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" />
            <line x1="25" y1="28" x2="35" y2="28" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" />
            <line x1="27" y1="22" x2="33" y2="22" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" />
            <line x1="28" y1="16" x2="32" y2="16" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" />
          </g>
        ) : (
          // Biological Root
          <g>
            <path 
              d={rootPath} 
              fill={rootFill} 
              stroke={rootStroke} 
              strokeWidth={rootStrokeWidth} 
              strokeLinejoin="round"
              strokeDasharray={isMissing ? '2 2' : 'none'}
            />
            {/* Root Canal Fillings (RCT / Gutta-Percha Red Canal Fillings) */}
            {procType === 'rct' && showRootCanals && (
              <g className="animate-fade-in">
                {type === 'molar' ? (
                  <>
                    <path d="M 21 43 Q 18 26 15 12" stroke={chartSettings?.rctColor || "#f43f5e"} strokeWidth="2.8" strokeLinecap="round" fill="none" />
                    <path d="M 21 43 Q 18 26 15 12" stroke="#fda4af" strokeWidth="1" strokeLinecap="round" fill="none" />
                    <path d="M 39 43 Q 42 26 45 12" stroke={chartSettings?.rctColor || "#f43f5e"} strokeWidth="2.8" strokeLinecap="round" fill="none" />
                    <path d="M 39 43 Q 42 26 45 12" stroke="#fda4af" strokeWidth="1" strokeLinecap="round" fill="none" />
                  </>
                ) : (
                  <>
                    <path d="M 30 43 L 30 10" stroke={chartSettings?.rctColor || "#f43f5e"} strokeWidth="3" strokeLinecap="round" fill="none" />
                    <path d="M 30 43 L 30 10" stroke="#fda4af" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                  </>
                )}
              </g>
            )}
          </g>
        )}

        {/* Crown Rendering */}
        <path 
          d={crownPath} 
          fill={crownFill} 
          stroke={crownStroke} 
          strokeWidth={crownStrokeWidth} 
          strokeLinejoin="round"
          strokeDasharray={isMissing ? '2 2' : 'none'}
        />

        {/* Overlays for specific conditions/materials on the crown */}
        {condition === 'decayed' && (
          <g>
            <circle cx="30" cy="65" r="5" fill="#450a0a" stroke="#ef4444" strokeWidth="1" />
            <circle cx="36" cy="72" r="3" fill="#450a0a" stroke="#ef4444" strokeWidth="1" />
            <circle cx="24" cy="70" r="2.5" fill="#450a0a" stroke="#ef4444" strokeWidth="1" />
          </g>
        )}

        {/* 1. Root Canal Access Cavity (حشو عصب) */}
        {procType === 'rct' && (
          <g className="animate-fade-in">
            <ellipse cx="30" cy="62" rx="7" ry="9" fill={chartSettings?.rctColor || "#f43f5e"} stroke="#9f1239" strokeWidth="1.5" />
            <ellipse cx="30" cy="62" rx="4" ry="5" fill="#fda4af" />
            <line x1="30" y1="56" x2="30" y2="68" stroke="#ffffff" strokeWidth="1.5" />
            <line x1="24" y1="62" x2="36" y2="62" stroke="#ffffff" strokeWidth="1.5" />
          </g>
        )}

        {/* 2. Composite Laser Filling (حشو تجميلي عادي) */}
        {procType === 'composite' && (
          <g className="animate-fade-in">
            <path 
              d="M 22 55 Q 30 66 38 55 Q 34 72 30 76 Q 26 72 22 55 Z" 
              fill="url(#composite-gradient)" 
              stroke={chartSettings?.compositeColor || "#0d9488"} 
              strokeWidth="1.5" 
              strokeLinejoin="round"
            />
            <path d="M 25 58 Q 30 63 35 58" fill="none" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        )}

        {/* 3. Amalgam Silver Filling (حشو أملجم فضي) */}
        {procType === 'amalgam' && (
          <g className="animate-fade-in">
            <path 
              d="M 21 54 Q 30 67 39 54 Q 35 73 30 77 Q 25 73 21 54 Z" 
              fill="url(#amalgam-gradient)" 
              stroke={chartSettings?.amalgamColor || "#1e293b"} 
              strokeWidth="1.8" 
              strokeLinejoin="round"
            />
            <path d="M 24 58 Q 30 63 36 58" fill="none" stroke="#e2e8f0" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="28" cy="62" r="1.5" fill="#ffffff" />
          </g>
        )}

        {/* 4. Ceramic Inlay Filling (حشو سيراميك) */}
        {procType === 'ceramic_filling' && (
          <g className="animate-fade-in">
            <path 
              d="M 21 54 Q 30 67 39 54 Q 35 73 30 77 Q 25 73 21 54 Z" 
              fill="url(#ceramic-inlay-gradient)" 
              stroke={chartSettings?.ceramicFillingColor || "#38bdf8"} 
              strokeWidth="1.5" 
              strokeLinejoin="round"
            />
            <path d="M 25 57 Q 30 62 35 57" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </g>
        )}

        {/* 5. Gold Crown Sheen (تلبيسة ذهبية) */}
        {procType === 'gold_crown' && (
          <g className="animate-fade-in">
            <path d="M 20 50 C 22 65, 23 75, 28 82" fill="none" stroke="#fef08a" strokeWidth="1.2" opacity="0.8" />
            <path d="M 40 50 C 38 65, 37 75, 32 82" fill="none" stroke="#78350f" strokeWidth="1" opacity="0.7" />
            <circle cx="30" cy="52" r="2" fill="#fffbeb" opacity="0.9" />
          </g>
        )}

        {/* 6. Silver Metallic Crown Sheen (تلبيسة فضية معدنية) */}
        {procType === 'silver_crown' && (
          <g className="animate-fade-in">
            <path d="M 18 52 L 42 52" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
            <path d="M 16 62 L 44 62" stroke="#1e293b" strokeWidth="1.2" opacity="0.6" />
            <path d="M 20 72 L 40 72" stroke="#ffffff" strokeWidth="1.5" opacity="0.8" />
          </g>
        )}

        {/* 7. White Zirconia Porcelain Crown Sheen (تلبيسة بيضاء / زيركون) */}
        {procType === 'white_crown' && (
          <g className="animate-fade-in">
            <path d="M 18 48 C 24 53, 36 53, 42 48" fill="none" stroke="#38bdf8" strokeWidth="1.2" opacity="0.8" />
            <path d="M 22 55 Q 30 60 38 55" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.95" />
            <circle cx="30" cy="65" r="2" fill="#38bdf8" opacity="0.4" />
          </g>
        )}

        {condition === 'bridge' && (
          <g className="animate-fade-in">
            <rect x="4" y="52" width="52" height="12" rx="3" fill="url(#bridge-metallic-gradient)" stroke="#312e81" strokeWidth="1.2" />
            <line x1="4" y1="58" x2="56" y2="58" stroke="#a5b4fc" strokeWidth="1.2" />
            <circle cx="14" cy="58" r="2.5" fill="#e0e7ff" stroke="#3730a3" strokeWidth="1" />
            <circle cx="46" cy="58" r="2.5" fill="#e0e7ff" stroke="#3730a3" strokeWidth="1" />
            <line x1="30" y1="52" x2="30" y2="64" stroke="#312e81" strokeWidth="1.5" />
          </g>
        )}

        {condition === 'denture' && (
          <g className="animate-fade-in">
            <path d="M 12 45 C 24 50, 36 50, 48 45" fill="none" stroke="#f43f5e" strokeWidth="2" opacity="0.6" />
          </g>
        )}

        {condition === 'ortho' && (
          <g className="animate-fade-in">
            <line x1="0" y1="62" x2="60" y2="62" stroke="#64748b" strokeWidth="2.5" />
            <line x1="0" y1="62" x2="60" y2="62" stroke="#38bdf8" strokeWidth="1.2" />
            <rect x="22" y="54" width="16" height="16" rx="3" fill="url(#silver-gradient)" stroke="#1e293b" strokeWidth="1.2" />
            <line x1="22" y1="62" x2="38" y2="62" stroke="#0f172a" strokeWidth="2" />
            <line x1="30" y1="54" x2="30" y2="70" stroke="#0f172a" strokeWidth="1.5" />
            <rect x="25" y="57" width="10" height="10" rx="2" fill="none" stroke="#0284c7" strokeWidth="2" />
            <circle cx="30" cy="62" r="2" fill="#38bdf8" />
          </g>
        )}

        {/* Red cross if missing */}
        {isMissing && (
          <g stroke="#f43f5e" strokeWidth="3" strokeLinecap="round">
            <line x1="15" y1="25" x2="45" y2="75" />
            <line x1="45" y1="25" x2="15" y2="75" />
          </g>
        )}
      </g>
    </svg>
  );
}

const getConditionLabel = (cond?: DentalTooth['condition'], isEn: boolean = false) => {
  if (isEn) {
    switch (cond) {
      case 'decayed': return 'Decayed';
      case 'missing': return 'Missing';
      case 'filled': return 'Filled';
      case 'crown': return 'Crown';
      case 'bridge': return 'Fixed Bridge';
      case 'denture': return 'Removable Denture';
      case 'implant': return 'Implant';
      case 'ortho': return 'Orthodontics';
      default: return 'Healthy';
    }
  }
  switch (cond) {
    case 'decayed': return 'تسوس (Decayed)';
    case 'missing': return 'مفقود (Missing)';
    case 'filled': return 'حشو (Filled)';
    case 'crown': return 'تلبيسة/طرابيش (Crown)';
    case 'bridge': return 'تركيبة/جسر ثابت (Fixed Bridge)';
    case 'denture': return 'تركيبة متحركة (Removable Denture)';
    case 'implant': return 'زراعة (Implant)';
    case 'ortho': return 'تقويم أسنان (Ortho)';
    default: return 'سليم (Healthy)';
  }
};

interface ToothAbsoluteItemProps {
  num: number;
  data?: DentalTooth;
  isEditing: boolean;
  isHovered?: boolean;
  isSelectedMulti?: boolean;
  activeSystem: 'universal' | 'palmer' | 'fdi' | 'all';
  onClick: (num: number) => void;
  onHover?: (num: number | null) => void;
}

const ToothAbsoluteItem = React.memo(({ num, data, isEditing, isHovered, isSelectedMulti, activeSystem, onClick, onHover }: ToothAbsoluteItemProps) => {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const isChild = num >= 101 && num <= 120;
  const isUpper = num <= 16 || (num >= 101 && num <= 110);

  const toothLetter = getToothLetter(num);
  const systems = getToothSystems(num);

  const toothSvgNode = (
    <button
      type="button"
      onClick={() => onClick(num)}
      onMouseEnter={() => onHover?.(num)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(num)}
      onBlur={() => onHover?.(null)}
      className={`w-9 h-12 flex items-center justify-center rounded-xl transition-all duration-150 pointer-events-auto cursor-pointer p-0.5 border relative touch-manipulation select-none active:scale-90 active:bg-indigo-500/35 ${
        isSelectedMulti
          ? 'border-sky-300 bg-sky-500/40 ring-4 ring-sky-400/80 scale-110 z-30 shadow-xl'
          : isEditing 
          ? 'border-indigo-500 bg-indigo-500/25 ring-2 ring-indigo-500/40 scale-110 z-20 shadow-md' 
          : isHovered
          ? 'border-sky-400 bg-sky-900/60 ring-2 ring-sky-400/50 scale-105 z-20 shadow-lg'
          : 'border-slate-800 bg-slate-900/90 hover:bg-slate-800 hover:border-slate-600 shadow-sm'
      }`}
    >
      <div className="w-8 h-11 flex items-center justify-center">
        <ToothSvg num={num} condition={data?.condition} isEditing={isEditing} isUpper={isUpper} tooth={data} />
      </div>
      {isSelectedMulti && (
        <span className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-sky-500 text-white rounded-full flex items-center justify-center text-[10px] font-black shadow-md border border-white animate-bounce">
          ✓
        </span>
      )}
      {/* Tiny badge indicator if not healthy */}
      {!isSelectedMulti && data?.condition && data.condition !== 'healthy' && (() => {
        const procType = getToothProcedureType(data.condition, data);
        const getBadgeInfo = () => {
          switch (procType) {
            case 'rct': return { text: isEn ? 'RCT' : 'عصب', bg: '#be123c' };
            case 'amalgam': return { text: isEn ? 'Amalgam' : 'أملجم', bg: '#334155' };
            case 'ceramic_filling': return { text: isEn ? 'Ceramic' : 'سيراميك', bg: '#0284c7' };
            case 'composite': return { text: isEn ? 'Fill' : 'حشو', bg: '#0d9488' };
            case 'gold_crown': return { text: isEn ? 'Gold' : 'ذهب', bg: '#d97706' };
            case 'silver_crown': return { text: isEn ? 'PFM' : 'فضة', bg: '#475569' };
            case 'white_crown': return { text: isEn ? 'Zircon' : 'زيركون', bg: '#0284c7' };
            case 'bridge': return { text: isEn ? 'Bridge' : 'ثابت', bg: '#4f46e5' };
            case 'denture': return { text: isEn ? 'Denture' : 'متحرك', bg: '#e11d48' };
            case 'implant': return { text: isEn ? 'Implant' : 'زرع', bg: '#475569' };
            case 'decayed': return { text: isEn ? 'Caries' : 'سوس', bg: '#ef4444' };
            case 'ortho': return { text: isEn ? 'Ortho' : 'تقويم', bg: '#0284c7' };
            default: return { text: '!', bg: '#64748b' };
          }
        };
        const info = getBadgeInfo();
        return (
          <span 
            className="absolute -top-1.5 -right-1 px-1 py-0.2 rounded text-[8.5px] font-black text-white border border-slate-950 shadow-xs flex items-center justify-center animate-pulse shrink-0" 
            style={{ backgroundColor: info.bg }} 
            title={getConditionLabel(data.condition, isEn)}
          >
            {info.text}
          </span>
        );
      })()}
    </button>
  );

  const palmerLabelCompact = (
    <span 
      className={`inline-block ${systems.palmerSymbol} leading-none font-sans font-black text-emerald-400 text-center w-3.5 h-3.5 flex items-center justify-center`} 
      style={{ fontSize: '10px' }}
      title="Palmer System"
    >
      {systems.palmer}
    </span>
  );

  const getActiveBadge = () => {
    if (activeSystem === 'universal') {
      return (
        <button
          type="button"
          onClick={() => onClick(num)}
          onMouseEnter={() => onHover?.(num)}
          onMouseLeave={() => onHover?.(null)}
          className="bg-slate-950 border border-amber-800/80 px-2.5 py-1 rounded-xl shadow-md text-[13px] font-black text-amber-400 font-mono pointer-events-auto select-none transition-all duration-150 cursor-pointer active:scale-90 hover:bg-slate-900"
        >
          {systems.universal}
        </button>
      );
    }
    if (activeSystem === 'palmer') {
      return (
        <button
          type="button"
          onClick={() => onClick(num)}
          onMouseEnter={() => onHover?.(num)}
          onMouseLeave={() => onHover?.(null)}
          className="bg-slate-950 border border-emerald-800/80 px-2.5 py-1 rounded-xl shadow-md text-[13px] font-black text-emerald-400 font-sans pointer-events-auto select-none flex items-center gap-0.5 transition-all duration-150 cursor-pointer active:scale-90 hover:bg-slate-900"
        >
          {palmerLabelCompact}
        </button>
      );
    }
    if (activeSystem === 'fdi') {
      if (isChild) {
        return (
          <button
            type="button"
            onClick={() => onClick(num)}
            onMouseEnter={() => onHover?.(num)}
            onMouseLeave={() => onHover?.(null)}
            className="bg-slate-950 border border-emerald-800/80 px-2.5 py-1 rounded-xl shadow-md text-[13px] font-black text-emerald-400 font-sans pointer-events-auto select-none flex items-center gap-0.5 transition-all duration-150 cursor-pointer active:scale-90 hover:bg-slate-900"
            title="نظام بالمر للأطفال (Palmer)"
          >
            {palmerLabelCompact}
          </button>
        );
      }
      return (
        <button
          type="button"
          onClick={() => onClick(num)}
          onMouseEnter={() => onHover?.(num)}
          onMouseLeave={() => onHover?.(null)}
          className="bg-slate-950 border border-pink-800/80 px-2.5 py-1 rounded-xl shadow-md text-[13px] font-black text-pink-400 font-mono pointer-events-auto select-none transition-all duration-150 cursor-pointer active:scale-90 hover:bg-slate-900"
          title="نظام FDI للبالغين"
        >
          {systems.fdi}
        </button>
      );
    }
    // 'all'
    return (
      <button
        type="button"
        onClick={() => onClick(num)}
        onMouseEnter={() => onHover?.(num)}
        onMouseLeave={() => onHover?.(null)}
        className="flex items-center gap-1.5 bg-slate-950 border border-indigo-800/80 px-3 py-1 rounded-xl shadow-md text-xs font-black text-indigo-400 pointer-events-auto select-none transition-all duration-150 cursor-pointer active:scale-90 hover:bg-slate-900"
      >
        <span className="font-mono text-[13px]" title="Universal System">{systems.universal}</span>
        <span className="text-indigo-800/60 font-normal">/</span>
        <span className={`${systems.palmerSymbol} font-sans leading-none flex items-center justify-center w-3.5 h-3.5`} title="Palmer System" style={{ fontSize: '12px' }}>{systems.palmer}</span>
        <span className="text-indigo-800/60 font-normal">/</span>
        <span className="font-mono text-[13px]" title="FDI System">{systems.fdi}</span>
      </button>
    );
  };

  const coords = isChild ? getChildCoordinates(num) : getAdultCoordinates(num);
  const dx = coords.x - 50;
  const dy = coords.y - 50;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ux = dist > 0 ? dx / dist : 0;
  const uy = dist > 0 ? dy / dist : 0;

  // Project outward radially based on active numbering system width
  const radialOffset = activeSystem === 'all' ? 48 : 42;

  return (
    <div 
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      style={{
        left: `${coords.x}%`,
        top: `${coords.y}%`,
        width: '36px',  // w-9
        height: '48px', // h-12
      }}
    >
      <div className="relative w-full h-full flex items-center justify-center select-none touch-none">
        {/* Tooth Button (Centers exactly at coordinates) */}
        {toothSvgNode}

        {/* Radial outward numbering badge to avoid any overlap with adjacent teeth or shapes */}
        <div 
          className="absolute z-30 whitespace-nowrap pointer-events-auto"
          style={{
            left: `calc(50% + ${ux * radialOffset}px)`,
            top: `calc(50% + ${uy * radialOffset}px)`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {getActiveBadge()}
        </div>
      </div>
    </div>
  );
});

ToothAbsoluteItem.displayName = 'ToothAbsoluteItem';

interface ConnectedProstheticsOverlayProps {
  chartState: { [key: number]: DentalTooth };
  dentitionType: 'adult' | 'child';
  multiSelectedTeeth?: number[];
  multiCondition?: DentalTooth['condition'];
  isMultiSelectMode?: boolean;
}

const getSmoothSplineSegments = (pts: Array<{ x: number; y: number }>): string => {
  if (pts.length < 2) return '';
  let path = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < pts.length ? pts[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) * 0.2;
    const cp1y = p1.y + (p2.y - p0.y) * 0.2;
    const cp2x = p2.x - (p3.x - p1.x) * 0.2;
    const cp2y = p2.y - (p3.y - p1.y) * 0.2;

    path += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return path;
};

const buildClosedDenturePath = (
  outerPts: Array<{ x: number; y: number }>,
  innerPts: Array<{ x: number; y: number }>
): string => {
  if (outerPts.length === 0 || innerPts.length === 0) return '';
  let d = `M ${outerPts[0].x.toFixed(1)},${outerPts[0].y.toFixed(1)}`;
  d += getSmoothSplineSegments(outerPts);
  const lastInner = innerPts[innerPts.length - 1];
  d += ` L ${lastInner.x.toFixed(1)},${lastInner.y.toFixed(1)}`;
  const reversedInner = [...innerPts].reverse();
  d += getSmoothSplineSegments(reversedInner);
  d += ' Z';
  return d;
};

const ConnectedProstheticsOverlay = React.memo(({
  chartState,
  dentitionType,
  multiSelectedTeeth = [],
  multiCondition,
  isMultiSelectMode
}: ConnectedProstheticsOverlayProps) => {
  const isChild = dentitionType === 'child';

  // Determine denture, bridge, and ortho teeth sets
  const dentureSet = new Set<number>();
  const bridgeSet = new Set<number>();
  const orthoSet = new Set<number>();

  Object.entries(chartState).forEach(([numStr, tooth]) => {
    const num = Number(numStr);
    if (tooth?.condition === 'denture') dentureSet.add(num);
    if (tooth?.condition === 'bridge') bridgeSet.add(num);
    if (tooth?.condition === 'ortho') orthoSet.add(num);
  });

  if (isMultiSelectMode && multiSelectedTeeth.length > 0 && multiCondition) {
    multiSelectedTeeth.forEach((num) => {
      if (multiCondition === 'denture') dentureSet.add(num);
      if (multiCondition === 'bridge') bridgeSet.add(num);
      if (multiCondition === 'ortho') orthoSet.add(num);
    });
  }

  const upperArchSeq = isChild
    ? [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

  const lowerArchSeq = isChild
    ? [120, 119, 118, 117, 116, 111, 112, 113, 114, 115]
    : [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];

  const groupTeeth = (teethSet: Set<number>, archSeq: number[]): number[][] => {
    const presentIndices = archSeq
      .map((num, idx) => ({ num, idx }))
      .filter((item) => teethSet.has(item.num));

    if (presentIndices.length === 0) return [];

    const groups: number[][] = [];
    let currentGroup: number[] = [presentIndices[0].num];

    for (let i = 1; i < presentIndices.length; i++) {
      const prevIdx = presentIndices[i - 1].idx;
      const currIdx = presentIndices[i].idx;

      if (currIdx - prevIdx === 1) {
        currentGroup.push(presentIndices[i].num);
      } else {
        groups.push(currentGroup);
        currentGroup = [presentIndices[i].num];
      }
    }
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    return groups;
  };

  const dentureUpperGroups = groupTeeth(dentureSet, upperArchSeq);
  const dentureLowerGroups = groupTeeth(dentureSet, lowerArchSeq);
  const bridgeUpperGroups = groupTeeth(bridgeSet, upperArchSeq);
  const bridgeLowerGroups = groupTeeth(bridgeSet, lowerArchSeq);
  const orthoUpperGroups = groupTeeth(orthoSet, upperArchSeq);
  const orthoLowerGroups = groupTeeth(orthoSet, lowerArchSeq);

  const getToothPoints = (num: number) => {
    const coord = isChild ? getChildCoordinates(num) : getAdultCoordinates(num);
    const px = (coord.x / 100) * 720;
    const py = (coord.y / 100) * 750;

    const dx = px - 360;
    const dy = py - 375;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    return {
      num,
      px,
      py,
      ux,
      uy,
      outer: { x: px + ux * 28, y: py + uy * 28 },
      inner: { x: px - ux * 18, y: py - uy * 18 },
      mid: { x: px + ux * 14, y: py + uy * 14 },
    };
  };

  const renderDentureGroup = (group: number[], gKey: string) => {
    if (group.length === 0) return null;
    const groupPts = group.map(getToothPoints);
    const outerPts = groupPts.map((p) => p.outer);
    const innerPts = groupPts.map((p) => p.inner);
    const midPts = groupPts.map((p) => p.mid);

    const closedPath = buildClosedDenturePath(outerPts, innerPts);
    const midSpline = `M ${midPts[0].x.toFixed(1)},${midPts[0].y.toFixed(1)}` + getSmoothSplineSegments(midPts);
    const innerSpline = `M ${innerPts[0].x.toFixed(1)},${innerPts[0].y.toFixed(1)}` + getSmoothSplineSegments(innerPts);

    const startP = groupPts[0];
    const endP = groupPts[groupPts.length - 1];

    const renderClasp = (p: ReturnType<typeof getToothPoints>, cKey: string) => {
      const vx = -p.uy;
      const vy = p.ux;
      const claspPath = `M ${(p.px - vx * 18).toFixed(1)},${(p.py - vy * 18).toFixed(1)} Q ${(p.px - p.ux * 12).toFixed(1)},${(p.py - p.uy * 12).toFixed(1)} ${(p.px + vx * 18).toFixed(1)},${(p.py + vy * 18).toFixed(1)}`;
      return (
        <g key={cKey}>
          <path d={claspPath} stroke="#1e293b" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d={claspPath} stroke="#e2e8f0" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx={p.px - p.ux * 12} cy={p.py - p.uy * 12} r="3.5" fill="#475569" stroke="#ffffff" strokeWidth="1" />
        </g>
      );
    };

    return (
      <g key={gKey} className="animate-fade-in">
        {/* Pink Acrylic Denture Gum Base */}
        <path
          d={closedPath}
          fill="url(#acrylic-pink-gradient)"
          stroke="#e11d48"
          strokeWidth="2"
          opacity={0.92}
          style={{ filter: 'drop-shadow(0px 3px 6px rgba(159, 18, 57, 0.45))' }}
        />
        {/* Midline Acrylic Gloss Line */}
        <path
          d={midSpline}
          fill="none"
          stroke="#ffffff"
          strokeWidth="3.5"
          strokeLinecap="round"
          opacity={0.55}
        />
        {/* Gingival Margin Margin Line */}
        <path
          d={innerSpline}
          fill="none"
          stroke="#f43f5e"
          strokeWidth="2"
          strokeDasharray="4 2"
          opacity={0.85}
        />
        {/* Retentive Metallic Silver Clasps */}
        {renderClasp(startP, `${gKey}-clasp-start`)}
        {group.length > 1 && renderClasp(endP, `${gKey}-clasp-end`)}
      </g>
    );
  };

  const renderBridgeGroup = (group: number[], gKey: string) => {
    if (group.length === 0) return null;
    const groupPts = group.map(getToothPoints);
    const centerPts = groupPts.map((p) => ({ x: p.px, y: p.py }));
    const centerSpline = `M ${centerPts[0].x.toFixed(1)},${centerPts[0].y.toFixed(1)}` + getSmoothSplineSegments(centerPts);

    return (
      <g key={gKey} className="animate-fade-in">
        {/* Dark drop outline */}
        <path
          d={centerSpline}
          fill="none"
          stroke="#1e1b4b"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.35}
        />
        {/* Main metallic indigo bridge bar */}
        <path
          d={centerSpline}
          fill="none"
          stroke="url(#bridge-metallic-gradient)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Inner metallic highlight */}
        <path
          d={centerSpline}
          fill="none"
          stroke="#c7d2fe"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.9}
        />
        {/* Interlocking Abutment Pins / Rivets at each tooth */}
        {groupPts.map((p) => (
          <g key={`${gKey}-pin-${p.num}`}>
            <circle cx={p.px} cy={p.py} r="6.5" fill="url(#bridge-gradient)" stroke="#312e81" strokeWidth="1.8" />
            <circle cx={p.px} cy={p.py} r="2.8" fill="#ffffff" opacity={0.85} />
          </g>
        ))}
      </g>
    );
  };

  const renderOrthoGroup = (group: number[], gKey: string) => {
    if (group.length < 2) return null;
    const groupPts = group.map(getToothPoints);
    const centerPts = groupPts.map((p) => ({ x: p.px, y: p.py }));
    const centerSpline = `M ${centerPts[0].x.toFixed(1)},${centerPts[0].y.toFixed(1)}` + getSmoothSplineSegments(centerPts);

    return (
      <g key={gKey} className="animate-fade-in">
        {/* Outer subtle cyan glow */}
        <path
          d={centerSpline}
          fill="none"
          stroke="#0284c7"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.35}
        />
        {/* Main metallic silver ortho arch wire */}
        <path
          d={centerSpline}
          fill="none"
          stroke="url(#silver-metallic-gradient)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Inner sky blue wire highlight */}
        <path
          d={centerSpline}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  };

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 720 750">
      {dentureUpperGroups.map((g, i) => renderDentureGroup(g, `denture-upper-${i}`))}
      {dentureLowerGroups.map((g, i) => renderDentureGroup(g, `denture-lower-${i}`))}
      {bridgeUpperGroups.map((g, i) => renderBridgeGroup(g, `bridge-upper-${i}`))}
      {bridgeLowerGroups.map((g, i) => renderBridgeGroup(g, `bridge-lower-${i}`))}
      {orthoUpperGroups.map((g, i) => renderOrthoGroup(g, `ortho-upper-${i}`))}
      {orthoLowerGroups.map((g, i) => renderOrthoGroup(g, `ortho-lower-${i}`))}
    </svg>
  );
});

ConnectedProstheticsOverlay.displayName = 'ConnectedProstheticsOverlay';

export default function DentalChart({ patientId, initialChart = {}, onSaveChart, readOnly = false, onSaveToothSession, clinicId, customServices, onUpdateCustomServices, categories, onUpdateCategories, patientAppointments, patientRecords }: DentalChartProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const dialogs = useDialogs();
  const [chartState, setChartState] = useState<{ [toothNumber: number]: DentalTooth }>(initialChart);
  const [dentitionType, setDentitionType] = useState<'adult' | 'child'>('adult');
  const [activeSystem, setActiveSystem] = useState<'universal' | 'palmer' | 'fdi' | 'all'>('fdi');
  const [hoveredTooth, setHoveredTooth] = useState<number | null>(null);

  const isInitialMount = useRef(true);
  const lastSavedChartRef = useRef<{ [toothNumber: number]: DentalTooth } | null>(null);

  const lastPatientIdRef = useRef<string | undefined>(patientId);
  if (patientId !== lastPatientIdRef.current) {
    lastPatientIdRef.current = patientId;
    lastSavedChartRef.current = null;
    isInitialMount.current = true;
  }

  const getToothProcedureHistory = useCallback((num: number) => {
    const list: Array<{
      id: string;
      condition?: DentalTooth['condition'];
      serviceName: string;
      notes?: string;
      date?: string;
      price?: number;
      source?: string;
    }> = [];

    const toothData = chartState[num];

    // 1. Check history stored on tooth object
    if (toothData?.history && Array.isArray(toothData.history)) {
      toothData.history.forEach((h, idx) => {
        list.push({
          id: `tooth-hist-${num}-${idx}`,
          condition: h.condition,
          serviceName: h.serviceName || getConditionLabel(h.condition, isEn),
          notes: h.notes,
          date: h.date,
          price: h.price,
          source: isEn ? 'Dental Chart' : 'خريطة الأسنان'
        });
      });
    }

    // 2. Check patientAppointments if passed
    if (patientAppointments && Array.isArray(patientAppointments)) {
      patientAppointments.forEach((app, appIdx) => {
        if (!app || app.status === 'cancelled') return;
        const appDate = app.date || app.createdAt;

        if (app.procedures && Array.isArray(app.procedures)) {
          app.procedures.forEach((p: any, pIdx: number) => {
            if (p && (Number(p.tooth) === num || String(p.tooth) === String(num))) {
              list.push({
                id: `app-proc-${app.id || appIdx}-${pIdx}`,
                serviceName: p.name || (isEn ? 'Clinic Procedure' : 'إجراء بالعيادة'),
                price: Number(p.price) || 0,
                date: appDate,
                notes: app.notes || app.treatmentType,
                source: isEn ? 'Clinical Session' : 'جلسة علاجية'
              });
            }
          });
        }

        if (Number(app.toothNumber) === num) {
          list.push({
            id: `app-tooth-${app.id || appIdx}`,
            serviceName: app.treatmentType || (isEn ? 'Dental Treatment' : 'علاج أسنان'),
            price: Number(app.price) || 0,
            date: appDate,
            notes: app.notes,
            source: isEn ? 'Patient Visit' : 'زيارة مريض'
          });
        }
      });
    }

    // 3. Check patientRecords if passed
    if (patientRecords && Array.isArray(patientRecords)) {
      patientRecords.forEach((rec, recIdx) => {
        if (!rec) return;
        if (rec.toothChart && rec.toothChart[num]) {
          const recTooth = rec.toothChart[num];
          if (recTooth && recTooth.condition !== 'healthy') {
            list.push({
              id: `rec-tooth-${rec.id || recIdx}`,
              condition: recTooth.condition,
              serviceName: recTooth.notes || getConditionLabel(recTooth.condition, isEn),
              notes: recTooth.notes || rec.treatment || rec.notes,
              date: recTooth.treatmentDate || rec.date,
              price: Number(rec.cost) || 0,
              source: isEn ? 'Medical Record' : 'سجل طبي'
            });
          }
        }
      });
    }

    // 4. Fallback if list is empty
    if (list.length === 0 && toothData && (toothData.condition !== 'healthy' || toothData.notes)) {
      list.push({
        id: `current-${num}`,
        condition: toothData.condition,
        serviceName: toothData.notes || getConditionLabel(toothData.condition, isEn),
        notes: toothData.notes,
        date: toothData.treatmentDate,
        source: isEn ? 'Current Clinical Status' : 'الحالة السريرية الحالية'
      });
    }

    // Deduplicate
    const uniqueList: typeof list = [];
    const seenKeys = new Set<string>();
    list.forEach(item => {
      const key = `${item.serviceName}-${item.date || ''}-${item.notes || ''}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueList.push(item);
      }
    });

    return uniqueList;
  }, [chartState, patientAppointments, patientRecords, isEn]);

  const hoveredToothData = hoveredTooth ? chartState[hoveredTooth] : undefined;
  const hoveredCoords = hoveredTooth ? (hoveredTooth >= 101 ? getChildCoordinates(hoveredTooth) : getAdultCoordinates(hoveredTooth)) : { x: 50, y: 50 };
  const hoveredHistory = hoveredTooth ? getToothProcedureHistory(hoveredTooth) : [];
  const hoveredSystems = hoveredTooth ? getToothSystems(hoveredTooth) : null;
  const hoveredArabicName = hoveredTooth ? getToothName(hoveredTooth, isEn) : '';
  const hoveredLetter = hoveredTooth ? getToothLetter(hoveredTooth) : '';

  const containerRef = useRef<HTMLDivElement>(null);
  const [chartScale, setChartScale] = useState(1);
  const [autoScale, setAutoScale] = useState(true);

  useEffect(() => {
    if (!autoScale) return;
    const handleResize = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        if (width < 720) {
          setChartScale(Math.max(0.42, (width - 16) / 720));
        } else {
          setChartScale(1);
        }
      }
    };
    handleResize();
    const timer = setTimeout(handleResize, 100);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [autoScale]);

  const hasAdultAction = Object.keys(chartState).some(key => {
    const num = Number(key);
    return num >= 1 && num <= 32 && chartState[num]?.condition !== 'healthy';
  });

  const hasChildAction = Object.keys(chartState).some(key => {
    const num = Number(key);
    return num >= 101 && num <= 120 && chartState[num]?.condition !== 'healthy';
  });

  // Derived state for adult maturity based on tooth chart key 999
  const isAdultMatured = Boolean(
    chartState[999]?.condition === 'matured' || (chartState as any)?.isAdultMatured?.condition === 'matured'
  );

  const saveChart = (updated: { [toothNumber: number]: DentalTooth }) => {
    lastSavedChartRef.current = updated;
    setChartState(updated);
    onSaveChart?.(updated);
  };

  useEffect(() => {
    let chartToApply = initialChart || {};
    lastSavedChartRef.current = chartToApply;
    setChartState({ ...chartToApply });

    if (isInitialMount.current) {
      isInitialMount.current = false;
      const isMaturedInChart = Boolean((initialChart as any)[999]?.condition === 'matured' || (initialChart as any)['isAdultMatured']?.condition === 'matured');
      const hasChildTeeth = Object.keys(initialChart || {}).some(key => {
        const num = Number(key);
        return num >= 101 && num <= 120 && initialChart[num]?.condition !== 'healthy';
      });

      if (hasChildTeeth && !isMaturedInChart) {
        setDentitionType('child');
        setActiveSystem('palmer');
      } else {
        setDentitionType('adult');
        setActiveSystem('fdi');
      }
    }
  }, [initialChart, patientId]);

  const handleResetChart = async () => {
    if (readOnly) return;
    const confirmReset = await dialogs.confirm(
      isEn 
        ? 'Are you sure you want to completely clear and reset the dental chart for this patient?\nAll clinical procedures and conditions recorded on this chart will be removed.'
        : 'هل أنت متأكد من تفريغ وإعادة ضبط خريطة الأسنان لهذا المريض تماماً؟\nسيتم إزالة جميع الإجراءات والحالات السريرية المسجلة على الرسم البياني لهذا المريض.',
      { 
        title: isEn ? 'Reset Dental Chart' : 'تفريغ خريطة الأسنان', 
        confirmLabel: isEn ? 'Yes, Reset Chart' : 'نعم، تفريغ الخريطة', 
        cancelLabel: isEn ? 'Cancel' : 'إلغاء', 
        severity: 'danger' 
      }
    );
    if (confirmReset) {
      saveChart({});
      setSelectedTooth(null);
      setMultiSelectedTeeth([]);
    }
  };

  const handleToggleMaturity = (val: boolean) => {
    const updatedChart = { ...chartState };
    if (val) {
      updatedChart[999] = { toothNumber: 999, condition: 'matured' as any };
      saveChart(updatedChart);
      setDentitionType('adult');
      setActiveSystem('fdi');
      setSelectedTooth(null);
      dialogs.alert(
        isEn 
          ? '🎉 "Adult Matured" status activated for this patient!\nSwitched to adult teeth chart while permanently preserving child teeth history.'
          : '🎉 تم تفعيل حالة "تم البلوغ" لهذا المريض!\nتم الانتقال لرسم أسنان البالغين مع حفظ كامل أرشيف أسنان الأطفال بملف المريض بشكل دائم.', 
        { severity: 'success' }
      );
    } else {
      delete updatedChart[999];
      saveChart(updatedChart);
    }
  };

  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);

  useEffect(() => {
    if (selectedTooth !== null) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedTooth]);

  // Modal editing state for selected tooth
  const [condition, setCondition] = useState<DentalTooth['condition']>('healthy');
  const [notes, setNotes] = useState('');
  const [serviceInput, setServiceInput] = useState(isEn ? 'Cosmetic Composite Laser Filling' : 'حشو ليزر تجميلي');
  const [priceInput, setPriceInput] = useState<number>(350);
  const [isSavingSession, setIsSavingSession] = useState(false);

  // Dynamic services and category management state
  const defaultCategories = isEn ? [
    'Fillings & Endodontics',
    'Extractions & Surgery',
    'Orthodontics & Aesthetics',
    'Crowns & Prosthetics',
    'Implants & Bridges',
    'Hygiene & Prevention',
    'Pediatric Dentistry',
    'General'
  ] : [
    'حشوات وعلاج عصب',
    'خلع وجراحة',
    'تقويم وتجميل الأسنان',
    'تركيبات وتلبيسات',
    'زراعة وجسور',
    'تنظيف وقاية وتجميل',
    'طب أسنان الأطفال',
    'عام'
  ];

  const defaultServices: CustomDentalService[] = isEn ? [
    { id: '1', name: 'Cosmetic Composite Laser Filling', price: 600, condition: 'filled', category: 'Fillings & Endodontics' },
    { id: '2', name: 'Full Root Canal Treatment (RCT)', price: 1500, condition: 'filled', category: 'Fillings & Endodontics' },
    { id: '3', name: 'Silver Amalgam Filling', price: 500, condition: 'filled', category: 'Fillings & Endodontics' },
    { id: '4', name: 'Ceramic / Inlay Cosmetic Filling', price: 1200, condition: 'filled', category: 'Fillings & Endodontics' },
    { id: '5', name: 'White Zirconia Crown', price: 2500, condition: 'crown', category: 'Crowns & Prosthetics' },
    { id: '6', name: '24k Gold Crown', price: 4000, condition: 'crown', category: 'Crowns & Prosthetics' },
    { id: '7', name: 'PFM Metal Crown', price: 1800, condition: 'crown', category: 'Crowns & Prosthetics' },
    { id: '8', name: 'Pediatric Pulpotomy / Root Canal', price: 800, condition: 'filled', category: 'Pediatric Dentistry' },
    { id: '9', name: 'Surgical / Simple Extraction', price: 700, condition: 'missing', category: 'Extractions & Surgery' },
    { id: '10', name: 'Scaling & Root Planing', price: 450, condition: 'healthy', category: 'Hygiene & Prevention' },
    { id: '11', name: 'Immediate Tooth Implant', price: 7500, condition: 'implant', category: 'Implants & Bridges' },
    { id: '12', name: '3-Unit Porcelain Bridge', price: 4500, condition: 'bridge', category: 'Implants & Bridges' },
    { id: '13', name: 'Partial / Full Removable Denture', price: 3000, condition: 'denture', category: 'Crowns & Prosthetics' },
    { id: '13b', name: 'Specific Teeth Orthodontics', price: 4000, condition: 'ortho', category: 'Orthodontics & Aesthetics' },
    { id: '14', name: 'Full Braces (Both Arches)', price: 8000, condition: 'ortho', category: 'Orthodontics & Aesthetics' },
    { id: '15', name: 'Upper/Lower Metal Braces', price: 5000, condition: 'ortho', category: 'Orthodontics & Aesthetics' },
    { id: '16', name: 'Clear Aligners (Invisalign)', price: 15000, condition: 'ortho', category: 'Orthodontics & Aesthetics' },
  ] : [
    { id: '1', name: 'حشو ليزر كومبوزيت تجميلي', price: 600, condition: 'filled', category: 'حشوات وعلاج عصب' },
    { id: '2', name: 'حشو عصب كامل (RCT)', price: 1500, condition: 'filled', category: 'حشوات وعلاج عصب' },
    { id: '3', name: 'حشو أملجم فضي (Amalgam)', price: 500, condition: 'filled', category: 'حشوات وعلاج عصب' },
    { id: '4', name: 'حشو سيراميك / إينلاي تجميلي', price: 1200, condition: 'filled', category: 'حشوات وعلاج عصب' },
    { id: '5', name: 'تلبيسة زيركون بيضاء (Zirconia)', price: 2500, condition: 'crown', category: 'تركيبات وتلبيسات' },
    { id: '6', name: 'تلبيسة ذهبية (Gold Crown 24k)', price: 4000, condition: 'crown', category: 'تركيبات وتلبيسات' },
    { id: '7', name: 'تلبيسة فضية معدنية (PFM Crown)', price: 1800, condition: 'crown', category: 'تركيبات وتلبيسات' },
    { id: '8', name: 'علاج عصب أطفال', price: 800, condition: 'filled', category: 'طب أسنان الأطفال' },
    { id: '9', name: 'خلع جراحي / عادي', price: 700, condition: 'missing', category: 'خلع وجراحة' },
    { id: '10', name: 'تنظيف وتلميع الجذور', price: 450, condition: 'healthy', category: 'تنظيف وقاية وتجميل' },
    { id: '11', name: 'زراعة ضرس فوري', price: 7500, condition: 'implant', category: 'زراعة وجسور' },
    { id: '12', name: 'جسر خزفي 3 وحدات', price: 4500, condition: 'bridge', category: 'زراعة وجسور' },
    { id: '13', name: 'تركيبة متحركة جزئية / كاملة', price: 3000, condition: 'denture', category: 'تركيبات وتلبيسات' },
    { id: '13b', name: 'تقويم أسنان محددة', price: 4000, condition: 'ortho', category: 'تقويم وتجميل الأسنان' },
    { id: '14', name: 'تركيب تقويم أسنان (كامل/فكين)', price: 8000, condition: 'ortho', category: 'تقويم وتجميل الأسنان' },
    { id: '15', name: 'تركيب تقويم معدني علوي/سفلي', price: 5000, condition: 'ortho', category: 'تقويم وتجميل الأسنان' },
    { id: '16', name: 'تقويم شفاف تجميلي (Invisalign)', price: 15000, condition: 'ortho', category: 'تقويم وتجميل الأسنان' },
  ];

  const [categoriesList, setCategoriesList] = useState<string[]>(() => {
    if (categories && categories.length > 0) return categories;
    if (clinicId) {
      const saved = safeStorage.getItem(`dental_categories_${clinicId}`);
      if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
      }
    }
    return defaultCategories;
  });

  useEffect(() => {
    if (categories && categories.length > 0) {
      setCategoriesList(categories);
    }
  }, [categories]);

  const [servicesList, setServicesList] = useState<CustomDentalService[]>(() => {
    if (customServices && customServices.length > 0) return customServices;
    if (clinicId) {
      const saved = safeStorage.getItem(`dental_services_${clinicId}`);
      if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
      }
    }
    return defaultServices;
  });

  useEffect(() => {
    if (customServices && customServices.length > 0) {
      setServicesList(customServices);
    }
  }, [customServices]);

  const [showManageServices, setShowManageServices] = useState(false);
  const [manageTab, setManageTab] = useState<'services' | 'categories'>('services');
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState<number>(350);
  const [newServiceCondition, setNewServiceCondition] = useState<DentalTooth['condition']>('filled');
  const [newServiceCategory, setNewServiceCategory] = useState<string>('حشوات وعلاج عصب');

  // Category filters and editing state
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCatIndex, setEditingCatIndex] = useState<number | null>(null);
  const [editCategoryVal, setEditCategoryVal] = useState('');

  const saveCategoriesList = async (newList: string[]) => {
    setCategoriesList(newList);
    if (clinicId) {
      safeStorage.setItem(`dental_categories_${clinicId}`, JSON.stringify(newList));
    }
    if (onUpdateCategories) {
      await onUpdateCategories(newList);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    if (categoriesList.includes(newCategoryName.trim())) return;
    const updated = [...categoriesList, newCategoryName.trim()];
    await saveCategoriesList(updated);
    setNewCategoryName('');
  };

  const handleUpdateCategory = async (oldCat: string, newCatName: string) => {
    if (!newCatName.trim()) return;
    const updated = categoriesList.map(c => c === oldCat ? newCatName.trim() : c);
    await saveCategoriesList(updated);
    // Also update any services assigned to this category
    const updatedServices = servicesList.map(s => s.category === oldCat ? { ...s, category: newCatName.trim() } : s);
    await saveServicesList(updatedServices);
    setEditingCatIndex(null);
  };

  const handleDeleteCategory = async (catName: string) => {
    if (readOnly) {
      dialogs.alert('عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    const updated = categoriesList.filter(c => c !== catName);
    await saveCategoriesList(updated);
    if (selectedCategoryFilter === catName) {
      setSelectedCategoryFilter('all');
    }
  };

  const saveServicesList = async (newList: CustomDentalService[]) => {
    setServicesList(newList);
    if (clinicId) {
      safeStorage.setItem(`dental_services_${clinicId}`, JSON.stringify(newList));
    }
    if (onUpdateCustomServices) {
      await onUpdateCustomServices(newList);
    }
  };

  const handleAddOrUpdateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServiceName.trim()) return;

    if (editingServiceId) {
      const updated = servicesList.map(s => s.id === editingServiceId ? {
        ...s,
        name: newServiceName.trim(),
        price: Number(newServicePrice) || 0,
        condition: newServiceCondition,
        category: newServiceCategory || 'عام'
      } : s);
      await saveServicesList(updated);
      setEditingServiceId(null);
    } else {
      const newSrv: CustomDentalService = {
        id: Date.now().toString(),
        name: newServiceName.trim(),
        price: Number(newServicePrice) || 0,
        condition: newServiceCondition,
        category: newServiceCategory || 'عام'
      };
      await saveServicesList([...servicesList, newSrv]);
    }
    setNewServiceName('');
    setNewServicePrice(350);
    setNewServiceCondition('filled');
  };

  const handleEditServiceClick = (srv: CustomDentalService) => {
    setEditingServiceId(srv.id);
    setNewServiceName(srv.name);
    setNewServicePrice(srv.price);
    setNewServiceCondition(srv.condition || 'filled');
    setNewServiceCategory(srv.category || categoriesList[0] || 'عام');
  };

  const handleDeleteService = async (id: string) => {
    if (readOnly) {
      dialogs.alert('عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    const updated = servicesList.filter(s => s.id !== id);
    await saveServicesList(updated);
    if (editingServiceId === id) {
      setEditingServiceId(null);
      setNewServiceName('');
    }
  };

  const autoDetectCondition = (name: string): DentalTooth['condition'] => {
    const lower = name.toLowerCase();
    if (lower.includes('طقم') || lower.includes('متحرك') || lower.includes('denture') || lower.includes('أكريليك')) return 'denture';
    if (lower.includes('جسر') || lower.includes('ثابت') || lower.includes('bridge') || lower.includes('تركيب ثابت') || lower.includes('تركيبة ثابتة')) return 'bridge';
    if (lower.includes('تقويم') || lower.includes('ortho') || lower.includes('braces')) return 'ortho';
    if (lower.includes('خلع') || lower.includes('extract') || lower.includes('مفقود')) return 'missing';
    if (lower.includes('تلبيس') || lower.includes('طربوش') || lower.includes('زيركون') || lower.includes('crown') || lower.includes('بورسلين') || lower.includes('ذهب') || lower.includes('فضة') || lower.includes('فضي') || lower.includes('pfm')) return 'crown';
    if (lower.includes('زرع') || lower.includes('زراع') || lower.includes('implant')) return 'implant';
    if (lower.includes('تسوس') || lower.includes('decay')) return 'decayed';
    if (lower.includes('تنظيف') || lower.includes('تلميع') || lower.includes('فحص')) return 'healthy';
    if (lower.includes('حشو') || lower.includes('عصب') || lower.includes('ليزر') || lower.includes('أملجم') || lower.includes('املجم') || lower.includes('سيراميك') || lower.includes('تجميل') || lower.includes('inlay')) return 'filled';
    return 'filled';
  };

  // General Multi-Tooth Selection State & Handlers
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [multiSelectedTeeth, setMultiSelectedTeeth] = useState<number[]>([]);
  const [multiPriceType, setMultiPriceType] = useState<'total' | 'per_tooth'>('total');

  const selectUpperArchMulti = () => {
    const upperTeeth = dentitionType === 'adult'
      ? Array.from({ length: 16 }, (_, i) => i + 1)
      : Array.from({ length: 10 }, (_, i) => 101 + i);
    setMultiSelectedTeeth(upperTeeth);
  };

  const selectLowerArchMulti = () => {
    const lowerTeeth = dentitionType === 'adult'
      ? [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17]
      : [120, 119, 118, 117, 116, 111, 112, 113, 114, 115];
    setMultiSelectedTeeth(lowerTeeth);
  };

  const selectBothArchesMulti = () => {
    const upperTeeth = dentitionType === 'adult'
      ? Array.from({ length: 16 }, (_, i) => i + 1)
      : Array.from({ length: 10 }, (_, i) => 101 + i);
    const lowerTeeth = dentitionType === 'adult'
      ? [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17]
      : [120, 119, 118, 117, 116, 111, 112, 113, 114, 115];
    setMultiSelectedTeeth([...upperTeeth, ...lowerTeeth]);
  };

  const selectAnteriorsMulti = () => {
    const anteriors = dentitionType === 'adult'
      ? [6, 7, 8, 9, 10, 11, 22, 23, 24, 25, 26, 27]
      : [103, 104, 105, 106, 107, 108, 113, 114, 115, 116, 117, 118];
    setMultiSelectedTeeth(anteriors);
  };

  const selectPosteriorsMulti = () => {
    const posteriors = dentitionType === 'adult'
      ? [1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 28, 29, 30, 31, 32]
      : [101, 102, 109, 110, 111, 112, 119, 120];
    setMultiSelectedTeeth(posteriors);
  };

  const handleToothClick = useCallback((num: number) => {
    if (readOnly) return;
    const isChildTooth = num >= 101 && num <= 120;
    const isAdultTooth = num >= 1 && num <= 32;

    if (isChildTooth && (isAdultMatured || hasAdultAction)) {
      dialogs.alert('عذراً، تم تفعيل حالة "تم البلوغ" لهذا المريض. تم قفل التعديل على أسنان الأطفال للحفاظ على سجلها كأرشيف تاريخي، ويمكنك التسجيل والتعديل على أسنان البالغين فقط.', { severity: 'warning' });
      return;
    }
    if (isAdultTooth && hasChildAction && !isAdultMatured) {
      dialogs.alert('عذراً، المريض مسجل بنظام أسنان الأطفال. لتسجيل علاج أو تعديل على أسنان البالغين، يرجى تفعيل مفتاح "تم البلوغ" من أعلى الرسم البياني أولاً.', { severity: 'warning' });
      return;
    }

    if (isMultiSelectMode) {
      setMultiSelectedTeeth(prev =>
        prev.includes(num) ? prev.filter(t => t !== num) : [...prev, num]
      );
      return;
    }

    setSelectedTooth(num);
    const existing = chartState[num];
    if (existing) {
      setCondition(existing.condition);
      setNotes(existing.notes || '');
    } else {
      setCondition('healthy');
      setNotes('');
    }
    setServiceInput('حشو ليزر تجميلي');
    setPriceInput(350);
  }, [readOnly, hasAdultAction, hasChildAction, isAdultMatured, isMultiSelectMode, chartState, dialogs]);

  const buildUpdatedToothData = (num: number, cond: DentalTooth['condition'], notesStr: string, serviceName?: string, priceVal?: number): DentalTooth => {
    const existingTooth = chartState[num];
    const oldHistory = existingTooth?.history || [];
    let historyList = [...oldHistory];

    if (historyList.length === 0 && existingTooth && existingTooth.condition && existingTooth.condition !== 'healthy') {
      historyList.push({
        condition: existingTooth.condition,
        notes: existingTooth.notes || '',
        date: existingTooth.treatmentDate || new Date().toISOString(),
      });
    }

    const newItem: DentalToothHistoryItem = {
      condition: cond,
      serviceName: serviceName || getConditionLabel(cond),
      notes: notesStr || '',
      date: new Date().toISOString(),
      price: priceVal || 0,
    };

    return {
      toothNumber: num,
      condition: cond,
      notes: notesStr,
      treatmentDate: new Date().toISOString(),
      history: [...historyList, newItem],
    };
  };

  const handleSaveTooth = () => {
    if (selectedTooth === null) return;
    const teethToUpdate = multiSelectedTeeth.length > 0 ? multiSelectedTeeth : [selectedTooth];
    const count = teethToUpdate.length;
    const updated = { ...chartState };

    const fdiListFormatted = teethToUpdate.map(num => `#${convertToFDI(num)}`).join(', ');
    const combinedNotesStr = count > 1 
      ? `إجراء جماعي لـ (${count}) أسنان [FDI: ${fdiListFormatted}]. ${notes.trim()}`.trim()
      : notes.trim();

    const serviceLabelWithCount = count > 1 
      ? `${serviceInput.trim()} (${count} أسنان)`
      : serviceInput.trim();

    const perToothPrice = multiPriceType === 'per_tooth' 
      ? Number(priceInput) || 0 
      : Math.round((Number(priceInput) || 0) / count);

    teethToUpdate.forEach(num => {
      updated[num] = buildUpdatedToothData(
        num,
        condition,
        combinedNotesStr,
        serviceLabelWithCount,
        perToothPrice
      );
    });

    saveChart(updated);
    setSelectedTooth(null);
    setMultiSelectedTeeth([]);
    setIsMultiSelectMode(false);
  };

  const handleSaveSessionAndTooth = async () => {
    if (selectedTooth === null) return;
    setIsSavingSession(true);
    try {
      const teethToUpdate = multiSelectedTeeth.length > 0 ? multiSelectedTeeth : [selectedTooth];
      const count = teethToUpdate.length;
      const updated = { ...chartState };

      const calculatedTotalPrice = multiPriceType === 'per_tooth' 
        ? (Number(priceInput) || 0) * count 
        : (Number(priceInput) || 0);

      const fdiListFormatted = teethToUpdate.map(num => `#${convertToFDI(num)}`).join(', ');
      const combinedNotesStr = count > 1 
        ? `إجراء جماعي لـ (${count}) أسنان [FDI: ${fdiListFormatted}]. ${notes.trim()}`.trim()
        : notes.trim();

      const serviceLabelWithCount = count > 1 
        ? `${serviceInput.trim()} (${count} أسنان)`
        : serviceInput.trim();

      const perToothPrice = multiPriceType === 'per_tooth' 
        ? Number(priceInput) || 0 
        : Math.round(calculatedTotalPrice / count);

      teethToUpdate.forEach(num => {
        updated[num] = buildUpdatedToothData(
          num,
          condition,
          combinedNotesStr,
          serviceLabelWithCount,
          perToothPrice
        );
      });

      saveChart(updated);

      if (onSaveToothSession) {
        const primaryTooth = teethToUpdate[0];
        const sys = getToothSystems(primaryTooth);
        const toothToPass = primaryTooth >= 101 ? primaryTooth : (sys.fdi ? Number(sys.fdi) : primaryTooth);
        await onSaveToothSession(
          toothToPass,
          condition,
          serviceLabelWithCount || 'علاج أسنان',
          calculatedTotalPrice,
          combinedNotesStr,
          updated
        );
      }

      setSelectedTooth(null);
      setMultiSelectedTeeth([]);
      setIsMultiSelectMode(false);
      if (count > 1) {
        dialogs.alert(`🎉 تم حفظ وتوثيق الجلسة وتطبيق الإجراء بنجاح على (${count}) أسنان!`, { severity: 'success' });
      }
    } finally {
      setIsSavingSession(false);
    }
  };

  const getConditionTextColors = (cond?: DentalTooth['condition']) => {
    switch (cond) {
      case 'decayed': return 'text-rose-400 font-extrabold';
      case 'missing': return 'text-slate-500 font-semibold line-through';
      case 'filled': return 'text-teal-400 font-extrabold';
      case 'crown': return 'text-amber-400 font-extrabold';
      case 'bridge': return 'text-indigo-400 font-extrabold';
      case 'implant': return 'text-sky-400 font-extrabold';
      case 'ortho': return 'text-cyan-400 font-extrabold';
      default: return 'text-slate-500 font-medium';
    }
  };

  return (
    <div className="space-y-6" dir={isEn ? "ltr" : "rtl"}>
      {/* Invisible global gradients definitions */}
      <svg className="absolute w-0 h-0" width="0" height="0">
        <defs>
          <linearGradient id="gold-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="50%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
          <linearGradient id="silver-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="50%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#475569" />
          </linearGradient>
          <linearGradient id="silver-metallic-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#cbd5e1" />
            <stop offset="35%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#64748b" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>
          <linearGradient id="zirconia-white-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#e0f2fe" />
          </linearGradient>
          <linearGradient id="composite-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f0fdf4" />
            <stop offset="50%" stopColor="#ccfbf1" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
          <linearGradient id="amalgam-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="50%" stopColor="#475569" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>
          <linearGradient id="ceramic-inlay-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="50%" stopColor="#e0f2fe" />
            <stop offset="100%" stopColor="#bae6fd" />
          </linearGradient>
          <linearGradient id="healthy-crown-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f1f5f9" />
          </linearGradient>
          <linearGradient id="healthy-root-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          {/* Bridge Indigo Metallic Gradient */}
          <linearGradient id="bridge-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e0e7ff" />
            <stop offset="50%" stopColor="#a5b4fc" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          <linearGradient id="bridge-metallic-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="50%" stopColor="#4338ca" />
            <stop offset="100%" stopColor="#312e81" />
          </linearGradient>
          {/* Denture Acrylic Pink Gradient */}
          <linearGradient id="acrylic-pink-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fecdd3" />
            <stop offset="50%" stopColor="#fda4af" />
            <stop offset="100%" stopColor="#f43f5e" />
          </linearGradient>
          <linearGradient id="denture-porcelain-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#fff1f2" />
            <stop offset="100%" stopColor="#fecdd3" />
          </linearGradient>
        </defs>
      </svg>



      {/* View Switchers & Ortho Multi-Tooth Button */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        {/* Dentition Type Switcher */}
        <div className="bg-slate-850 p-1.5 rounded-2xl flex items-center gap-1 shadow-inner border border-slate-750">
          <button
            type="button"
            onClick={() => {
              setDentitionType('adult');
              setActiveSystem('fdi');
              setSelectedTooth(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              dentitionType === 'adult'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {isEn ? '🦷 Adult Teeth (32 Teeth - FDI)' : '🦷 أسنان البالغين (32 سن - FDI)'}
          </button>
          <button
            type="button"
            onClick={() => {
              setDentitionType('child');
              setActiveSystem('palmer');
              setSelectedTooth(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              dentitionType === 'child'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {isEn ? '👶 Child Teeth (20 Teeth - Palmer)' : '👶 أسنان الأطفال (20 سن - Palmer)'}
          </button>
        </div>

        {/* General Multi-Tooth Selection Button */}
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsMultiSelectMode(prev => !prev);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-xs shadow-md hover:shadow-lg transition-all cursor-pointer select-none active:scale-95 border ${
                isMultiSelectMode
                  ? 'bg-sky-600 text-white border-sky-300 shadow-sky-500/30 ring-2 ring-sky-400/50'
                  : 'bg-gradient-to-r from-sky-700 to-indigo-700 hover:from-sky-600 hover:to-indigo-600 text-white border-sky-400/30'
              }`}
            >
              <span>
                {isMultiSelectMode 
                  ? (isEn ? '🟢 Selection Active (Click to cancel)' : '🟢 وضع التحديد مفعّل (انقر لإلغاء)') 
                  : (isEn ? '🔘 Select Multiple Teeth (Bridge/Ortho/Denture)' : '🔘 تحديد أسنان متعددة (تركيبة/جسر/تقويم)')}
              </span>
              {multiSelectedTeeth.length > 0 && (
                <span className="bg-white text-sky-800 px-2 py-0.5 rounded-full font-extrabold text-[11px] shadow-2xs">
                  {multiSelectedTeeth.length}
                </span>
              )}
            </button>

            {Object.keys(chartState).length > 0 && (
              <button
                type="button"
                onClick={handleResetChart}
                title={isEn ? 'Reset dental chart for this patient' : 'تفريغ خريطة الأسنان لهذا المريض'}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl font-bold text-xs bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/80 transition cursor-pointer active:scale-95 shadow-md"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{isEn ? 'Reset Chart' : 'إعادة ضبط الخريطة'}</span>
              </button>
            )}
          </div>
        )}

        {/* Maturity Status Toggle Button - Shown ONLY when viewing Child Chart */}
        {dentitionType === 'child' && (
          <button
            type="button"
            onClick={() => handleToggleMaturity(!isAdultMatured)}
            className={`flex items-center gap-2.5 px-3.5 py-1.5 rounded-2xl border transition-all cursor-pointer select-none ${
              isAdultMatured 
                ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300 shadow-sm hover:bg-emerald-900/80' 
                : 'bg-slate-900 border-slate-750 hover:border-slate-600 text-slate-300'
            }`}
          >
            <div className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors ${isAdultMatured ? 'bg-emerald-500' : 'bg-slate-700'}`}>
              <div className={`w-4 h-4 bg-white rounded-full transition-transform ${isAdultMatured ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
            </div>
            <div className={`flex flex-col ${isEn ? 'text-left' : 'text-right'}`}>
              <span className={`text-xs font-black transition ${isAdultMatured ? 'text-emerald-300' : 'text-slate-300'}`}>
                {isAdultMatured 
                  ? (isEn ? '✨ Adult Matured (Active)' : '✨ تم البلوغ (مفعّل)') 
                  : (isEn ? 'Adult Matured (Switch to Adult)' : 'تم البلوغ (الانتقال للبالغين)')}
              </span>
              <span className="text-[10px] text-slate-400">
                {isAdultMatured 
                  ? (isEn ? 'Permanent archive - allows editing adult teeth' : 'حفظ دائم - يسمح بالتعديل على أسنان البالغين') 
                  : (isEn ? 'Enable editing adult teeth' : 'تفعيل التعديل على أسنان البالغين')}
              </span>
            </div>
          </button>
        )}
      </div>

      {dentitionType === 'child' && (hasChildAction || isAdultMatured) && (
        <div className="max-w-[720px] mx-auto bg-white border border-slate-300 rounded-xl px-3.5 py-2 flex items-center justify-between text-xs text-slate-900 font-bold shadow-xs gap-2">
          <div className="flex items-center gap-2">
            <span>{isAdultMatured ? '🔒' : '👶'}</span>
            <span>
              {isAdultMatured 
                ? (isEn ? 'Adult Matured status active - Child teeth record saved as read-only historical archive.' : 'تم تفعيل حالة "تم البلوغ" - سجل أسنان الأطفال محفوظ كأرشيف تاريخي للعرض فقط، ولا يمكن التعديل عليه.')
                : (isEn ? 'Patient registered with child dentition. Upon maturity, enable "Adult Matured" to switch to adult teeth.' : 'المريض مسجل بنظام أسنان الأطفال. عند بلوغ المريض، قم بتفعيل خيار "تم البلوغ" للتحويل لأسنان البالغين.')}
            </span>
          </div>
        </div>
      )}

      {/* Active Multi-Tooth Selection Mode Banner */}
      {isMultiSelectMode && !readOnly && (
        <div className="w-full max-w-[720px] mx-auto bg-slate-900 border-2 border-sky-500/90 rounded-2xl p-3.5 shadow-2xl space-y-2.5 animate-fade-in text-white my-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
              </span>
              <span className="font-black text-xs sm:text-sm text-sky-300">
                {isEn ? 'Multi-Tooth Selection Mode Active' : 'وضع تحديد الأسنان المتعددة مفعّل'}
              </span>
              <span className="bg-sky-500/20 text-sky-200 text-xs font-bold px-2.5 py-0.5 rounded-full border border-sky-400/40 font-mono">
                {multiSelectedTeeth.length} {isEn ? 'teeth selected' : 'أسنان محددة'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsMultiSelectMode(false);
                setMultiSelectedTeeth([]);
              }}
              className="text-slate-400 hover:text-rose-400 text-xs font-extrabold transition flex items-center gap-1 cursor-pointer bg-slate-800 px-2.5 py-1 rounded-xl border border-slate-700"
            >
              <X className="h-3.5 w-3.5" />
              <span>{isEn ? 'Cancel Selection' : 'إلغاء وضع التحديد'}</span>
            </button>
          </div>

          <p className="text-xs text-slate-300 font-medium leading-relaxed">
            👆 <strong>{isEn ? 'Selection Instructions:' : 'تعليمات التحديد:'}</strong> {isEn ? 'Click teeth directly on the anatomical chart below to select/deselect, then click "Apply Procedure".' : 'اضغط مباشرة على الأسنان في الرسم البياني للفك بالأسفل لتحديدها أو إلغاء تحديدها، ثم اضغط زر "اختيار وتطبيق الإجراء الطبي".'}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
            {/* Quick preset buttons */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-400 font-bold ml-1 text-[11px]">{isEn ? 'Quick Select:' : 'تحديد سريع:'}</span>
              <button
                type="button"
                onClick={selectBothArchesMulti}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-sky-300 rounded-lg font-bold border border-slate-700 text-[11px] transition cursor-pointer"
              >
                {isEn ? 'Both Arches (32)' : 'الفكين معاً (32 سن)'}
              </button>
              <button
                type="button"
                onClick={selectUpperArchMulti}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-sky-300 rounded-lg font-bold border border-slate-700 text-[11px] transition cursor-pointer"
              >
                {isEn ? 'Upper Arch' : 'الفك العلوي'}
              </button>
              <button
                type="button"
                onClick={selectLowerArchMulti}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-sky-300 rounded-lg font-bold border border-slate-700 text-[11px] transition cursor-pointer"
              >
                {isEn ? 'Lower Arch' : 'الفك السفلي'}
              </button>
              <button
                type="button"
                onClick={selectAnteriorsMulti}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-indigo-300 rounded-lg font-bold border border-slate-700 text-[11px] transition cursor-pointer"
              >
                {isEn ? 'Anteriors' : 'الأمامية'}
              </button>
              <button
                type="button"
                onClick={selectPosteriorsMulti}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-amber-300 rounded-lg font-bold border border-slate-700 text-[11px] transition cursor-pointer"
              >
                {isEn ? 'Posteriors' : 'الأضراس'}
              </button>
              {multiSelectedTeeth.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMultiSelectedTeeth([])}
                  className="px-2.5 py-1 bg-rose-950/70 hover:bg-rose-900/90 text-rose-300 rounded-lg font-bold border border-rose-800/80 text-[11px] transition cursor-pointer"
                >
                  {isEn ? 'Clear All' : 'مسح الكل'}
                </button>
              )}
            </div>

            {/* Main Action Button */}
            <button
              type="button"
              onClick={() => {
                if (multiSelectedTeeth.length === 0) {
                  dialogs.alert(isEn ? 'Please click at least one tooth on the chart before choosing a procedure.' : 'يرجى النقر على سن واحد على الأقل في الرسم البياني قبل اختيار الإجراء الطبي.', { severity: 'warning' });
                  return;
                }
                const firstTooth = multiSelectedTeeth[0];
                setSelectedTooth(firstTooth);
                const existing = chartState[firstTooth];
                if (existing) {
                  setCondition(existing.condition || 'ortho');
                  setNotes(existing.notes || '');
                  setServiceInput(existing.serviceName || (isEn ? 'Specific Teeth Orthodontics' : 'تقويم أسنان محددة'));
                  setPriceInput(existing.price || 4000);
                } else {
                  setCondition('ortho');
                  setNotes('');
                  setServiceInput(isEn ? 'Specific Teeth Orthodontics' : 'تقويم أسنان محددة');
                  setPriceInput(4000);
                }
              }}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer flex items-center gap-1.5 border border-emerald-400/40 active:scale-95"
            >
              <Sparkles className="h-4 w-4" />
              <span>{isEn ? `Apply Procedure (${multiSelectedTeeth.length} teeth)` : `اختيار وتطبيق الإجراء (${multiSelectedTeeth.length} أسنان)`}</span>
            </button>
          </div>
        </div>
      )}

      {/* Zoom / Scale Controls */}
      <div className="flex flex-wrap items-center justify-between px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-2xl max-w-[720px] mx-auto gap-3 text-white">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setAutoScale(false);
              setChartScale(prev => Math.max(0.4, prev - 0.05));
            }}
            className="w-8 h-8 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-750 rounded-xl transition text-slate-300 hover:text-white font-extrabold text-xs shadow-xs cursor-pointer select-none"
            title={isEn ? 'Zoom Out' : 'تصغير'}
          >
            ➖
          </button>
          <span className="text-xs font-mono font-black min-w-[48px] text-center text-slate-200">
            {Math.round(chartScale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => {
              setAutoScale(false);
              setChartScale(prev => Math.min(1.5, prev + 0.05));
            }}
            className="w-8 h-8 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-750 rounded-xl transition text-slate-300 hover:text-white font-extrabold text-xs shadow-xs cursor-pointer select-none"
            title={isEn ? 'Zoom In' : 'تكبير'}
          >
            ➕
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAutoScale(true);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
              autoScale
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/10'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-750'
            }`}
          >
            {isEn ? '🔍 Auto Fit Screen' : '🔍 ملائمة تلقائية للشاشة'}
          </button>

          {!autoScale && (
            <button
              type="button"
              onClick={() => {
                setChartScale(1);
                setAutoScale(false);
              }}
              className="px-3 py-1.5 bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold border border-slate-800 transition cursor-pointer"
            >
              {isEn ? 'Full Size (100%)' : 'الحجم الكامل (100%)'}
            </button>
          )}
        </div>
      </div>

      {/* Anatomical Arch Diagram Container */}
      <div ref={containerRef} className="w-full overflow-hidden flex flex-col items-center">
        <div
          className="relative origin-top transition-transform duration-200 ease-out"
          style={{
            transform: `scale(${chartScale})`,
            width: '720px',
            height: '750px',
            marginBottom: `${(chartScale - 1) * 750}px`
          }}
        >
          <div className="absolute inset-0 bg-slate-950 p-6 rounded-3xl border border-slate-800/80 shadow-2xl overflow-visible">
            {/* Midline vertical dashed line */}
            <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-slate-800/30 pointer-events-none select-none z-0"></div>
            {/* Midline horizontal dashed line */}
            <div className="absolute top-1/2 left-0 right-0 border-t border-dashed border-slate-800/30 pointer-events-none select-none z-0"></div>

            {/* Connected Prosthetics Overlay (Pink Acrylic Denture Base & Fixed Bridge Bar) */}
            <ConnectedProstheticsOverlay
              chartState={chartState}
              dentitionType={dentitionType}
              multiSelectedTeeth={multiSelectedTeeth}
              multiCondition={condition}
              isMultiSelectMode={isMultiSelectMode}
            />

            {/* Legend center text & Interactive System Selector */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center bg-slate-950/95 border border-slate-800 p-3 rounded-2xl shadow-xl space-y-1.5 pointer-events-auto z-20 min-w-[135px]">
              <div className="text-xs text-slate-400 font-bold pb-1.5 border-b border-slate-800/80">
                {isEn ? 'Active System' : 'نظام الترقيم النشط'}
              </div>
              
              <button
                type="button"
                onClick={() => setActiveSystem('universal')}
                className={`w-full py-1 px-2 rounded-lg text-xs font-black tracking-wider uppercase flex items-center justify-between transition-all duration-150 cursor-pointer ${
                  activeSystem === 'universal'
                    ? 'bg-amber-500/20 border border-amber-500/60 text-amber-400 font-extrabold shadow-xs'
                    : 'bg-slate-900/40 border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeSystem === 'universal' ? 'bg-amber-400 animate-pulse' : 'bg-amber-500'}`}></span>
                  Universal
                </span>
                {activeSystem === 'universal' && <span className="text-xs font-bold">✓</span>}
              </button>

              <button
                type="button"
                onClick={() => setActiveSystem('palmer')}
                className={`w-full py-1 px-2 rounded-lg text-xs font-black tracking-wider uppercase flex items-center justify-between transition-all duration-150 cursor-pointer ${
                  activeSystem === 'palmer'
                    ? 'bg-emerald-500/20 border border-emerald-500/60 text-emerald-400 font-extrabold shadow-xs'
                    : 'bg-slate-900/40 border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeSystem === 'palmer' ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-400'}`}></span>
                  Palmer
                </span>
                {activeSystem === 'palmer' && <span className="text-xs font-bold">✓</span>}
              </button>

              <button
                type="button"
                onClick={() => setActiveSystem('fdi')}
                className={`w-full py-1 px-2 rounded-lg text-xs font-black tracking-wider uppercase flex items-center justify-between transition-all duration-150 cursor-pointer ${
                  activeSystem === 'fdi'
                    ? 'bg-pink-500/20 border border-pink-500/60 text-pink-400 font-extrabold shadow-xs'
                    : 'bg-slate-900/40 border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeSystem === 'fdi' ? 'bg-pink-400 animate-pulse' : 'bg-pink-500'}`}></span>
                  {isEn ? 'FDI (Global)' : 'FDI (عالمي)'}
                </span>
                {activeSystem === 'fdi' && <span className="text-xs font-bold">✓</span>}
              </button>

              <button
                type="button"
                onClick={() => setActiveSystem('all')}
                className={`w-full py-1 px-2 rounded-lg text-xs font-black tracking-wider uppercase flex items-center justify-between transition-all duration-150 cursor-pointer ${
                  activeSystem === 'all'
                    ? 'bg-slate-800 border border-slate-600 text-white font-extrabold shadow-xs'
                    : 'bg-slate-900/40 border border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-850'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                  {isEn ? 'Show All' : 'عرض الكل'}
                </span>
                {activeSystem === 'all' && <span className="text-xs font-bold">✓</span>}
              </button>

              <div className="text-xs text-slate-500 font-bold border-t border-slate-900 pt-1.5 mt-1">
                {isEn ? 'Click to change' : 'انقر لتغيير الترقيم'}
              </div>
            </div>

            {/* Teeth list */}
            {dentitionType === 'adult' ? (
              Array.from({ length: 32 }, (_, i) => i + 1).map((num) => (
                <ToothAbsoluteItem
                  key={num}
                  num={num}
                  data={chartState[num]}
                  isEditing={selectedTooth === num}
                  isHovered={hoveredTooth === num}
                  isSelectedMulti={multiSelectedTeeth.includes(num)}
                  activeSystem={activeSystem}
                  onClick={handleToothClick}
                  onHover={setHoveredTooth}
                />
              ))
            ) : (
              Array.from({ length: 20 }, (_, i) => 101 + i).map((num) => (
                <ToothAbsoluteItem
                  key={num}
                  num={num}
                  data={chartState[num]}
                  isEditing={selectedTooth === num}
                  isHovered={hoveredTooth === num}
                  isSelectedMulti={multiSelectedTeeth.includes(num)}
                  activeSystem={activeSystem}
                  onClick={handleToothClick}
                  onHover={setHoveredTooth}
                />
              ))
            )}

            {/* Hover Tooltip - Procedure History Popup Box (Centered over center numbering system box) */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none">
              <AnimatePresence>
                {hoveredTooth !== null && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                  >
                    <div className={`bg-slate-950/98 border-2 border-sky-500/80 backdrop-blur-xl text-white p-3.5 rounded-2xl shadow-2xl w-72 sm:w-80 space-y-2.5 ${isEn ? 'text-left' : 'text-right'} font-sans text-xs`}>
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div>
                        <h4 className="font-extrabold text-xs text-white leading-snug">
                          {getToothName(hoveredTooth, isEn)}
                        </h4>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono mt-0.5">
                          <span className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-300 font-bold">#{hoveredLetter}</span>
                          {hoveredSystems && (
                            <span>(FDI: {hoveredSystems.fdi} | Palmer: {hoveredSystems.palmer})</span>
                          )}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black shrink-0 ${
                        hoveredToothData?.condition === 'decayed' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                        hoveredToothData?.condition === 'filled' ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40' :
                        hoveredToothData?.condition === 'crown' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                        hoveredToothData?.condition === 'bridge' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' :
                        hoveredToothData?.condition === 'denture' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                        hoveredToothData?.condition === 'implant' ? 'bg-slate-500/20 text-slate-300 border border-slate-500/40' :
                        hoveredToothData?.condition === 'ortho' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}>
                        {getConditionLabel(hoveredToothData?.condition, isEn)}
                      </span>
                    </div>

                    {/* History / Procedures List */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-extrabold text-sky-300 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <History className="h-3 w-3 text-sky-400" />
                          <span>{isEn ? 'Procedure history for this tooth:' : 'سجل الإجراءات على هذا السن:'}</span>
                        </span>
                        <span className="text-[9px] bg-sky-950 text-sky-300 px-1.5 py-0.2 rounded-full font-bold border border-sky-800/60">
                          {hoveredHistory.length} {isEn ? 'procedures' : 'إجراء'}
                        </span>
                      </div>

                      {hoveredHistory.length === 0 ? (
                        <div className="bg-slate-900/80 border border-slate-800/80 p-2.5 rounded-xl text-center space-y-0.5">
                          <p className="text-xs font-bold text-emerald-400">{isEn ? '✨ Tooth is completely healthy' : '✨ السن سليم تماماً'}</p>
                          <p className="text-[10px] text-slate-400">{isEn ? 'No previous fillings, crowns, or procedures.' : 'لا توجد حشوات أو تلبيسات أو إجراءات سابقة.'}</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {hoveredHistory.map((item, idx) => (
                            <div key={item.id || idx} className="bg-slate-900/90 border border-slate-800/80 p-2 rounded-xl space-y-0.5 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-extrabold text-sky-200 flex items-center gap-1 text-[11px]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0"></span>
                                  {item.serviceName}
                                </span>
                                {item.price ? (
                                  <span className="font-mono font-bold text-emerald-400 text-[10px] bg-emerald-950/60 border border-emerald-800/60 px-1 py-0.2 rounded shrink-0">
                                    {item.price} {isEn ? 'EGP' : 'ج.م'}
                                  </span>
                                ) : null}
                              </div>

                              {item.notes && (
                                <p className={`text-[10px] text-slate-300 ${isEn ? 'pl-2 border-l-2' : 'pr-2 border-r-2'} border-sky-500/50 leading-tight`}>
                                  {item.notes}
                                </p>
                              )}

                              {item.date && (
                                <div className="text-[9px] text-slate-400 flex items-center justify-between pt-0.5 border-t border-slate-800/60">
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-2.5 w-2.5 text-slate-500 shrink-0" />
                                    {new Date(item.date).toLocaleDateString(isEn ? 'en-US' : 'ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })}
                                  </span>
                                  {item.source && (
                                    <span className="text-[8.5px] text-indigo-300 bg-indigo-950/80 border border-indigo-800/50 px-1 py-0.2 rounded shrink-0">
                                      {item.source}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Color Legend */}
      <div className="flex flex-wrap justify-center gap-2.5 bg-white p-3.5 rounded-2xl border border-slate-200/80 text-xs font-bold text-slate-700 shadow-xs">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-xl border border-slate-200/60">
          <span className="w-3.5 h-3.5 rounded bg-white border border-slate-300"></span>
          <span>{isEn ? 'Healthy' : 'سليم'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-50 rounded-xl border border-rose-200/60 text-rose-900">
          <span className="w-3.5 h-3.5 rounded bg-rose-500"></span>
          <span>{isEn ? 'Decayed' : 'تسوس'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-50 rounded-xl border border-rose-200/60 text-rose-950">
          <span className="w-3.5 h-3.5 rounded bg-rose-700 border border-rose-900 flex items-center justify-center text-[8px] text-white font-mono font-black">RCT</span>
          <span>{isEn ? 'Root Canal (RCT)' : 'حشو عصب'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-teal-50 rounded-xl border border-teal-200/60 text-teal-900">
          <span className="w-3.5 h-3.5 rounded bg-teal-600"></span>
          <span>{isEn ? 'Composite Filling' : 'حشو كومبوزيت'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded-xl border border-slate-300 text-slate-900">
          <span className="w-3.5 h-3.5 rounded bg-slate-700"></span>
          <span>{isEn ? 'Silver Amalgam' : 'حشو أملجم فضي'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-sky-50 rounded-xl border border-sky-200/60 text-sky-900">
          <span className="w-3.5 h-3.5 rounded bg-sky-400"></span>
          <span>{isEn ? 'Ceramic Filling' : 'حشو سيراميك'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-xl border border-amber-200/60 text-amber-900">
          <span className="w-3.5 h-3.5 rounded bg-amber-500"></span>
          <span>{isEn ? 'Gold Crown' : 'تلبيسة ذهبية'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded-xl border border-slate-300 text-slate-800">
          <span className="w-3.5 h-3.5 rounded bg-slate-400"></span>
          <span>{isEn ? 'PFM Crown' : 'تلبيسة فضية (PFM)'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-sky-50 rounded-xl border border-sky-200/60 text-sky-950">
          <span className="w-3.5 h-3.5 rounded bg-white border border-sky-400"></span>
          <span>{isEn ? 'Zirconia Crown' : 'تلبيسة زيركون بيضاء'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-indigo-50 rounded-xl border border-indigo-200/60 text-indigo-900">
          <span className="w-3.5 h-3.5 rounded bg-indigo-600"></span>
          <span>{isEn ? 'Fixed Bridge' : 'جسر ثابت'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-50 rounded-xl border border-rose-200/60 text-rose-900">
          <span className="w-3.5 h-3.5 rounded bg-rose-500 border border-rose-600"></span>
          <span>{isEn ? 'Removable Denture' : 'تركيبة متحركة'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded-xl border border-slate-300 text-slate-800">
          <span className="w-3.5 h-3.5 rounded bg-slate-600"></span>
          <span>{isEn ? 'Implant' : 'زراعة'}</span>
        </div>
      </div>

      {/* Tooth Edit Dialog / Modal */}
      <AnimatePresence>
        {selectedTooth !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-[2px] overflow-y-auto"
            onClick={() => setSelectedTooth(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="bg-slate-50 w-full max-w-5xl xl:max-w-6xl rounded-3xl border border-slate-200/80 shadow-2xl space-y-4 my-auto max-h-[95vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
            <div className={`p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 ${isEn ? 'text-left' : 'text-right'} scroll-smooth [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]`} dir={isEn ? "ltr" : "rtl"}>
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <span className={`w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black shadow-sm ${selectedTooth >= 101 ? 'font-sans text-emerald-100 bg-emerald-600' : 'font-mono'}`}>
                {getToothLetter(selectedTooth)}
              </span>
              <div>
                <h4 className="font-bold text-slate-800 text-sm">
                  {isEn ? (
                    `Edit Tooth Condition ${selectedTooth >= 101 ? `Primary #${getToothLetter(selectedTooth)}` : `#${getToothLetter(selectedTooth)}`} (${getToothName(selectedTooth, true)})`
                  ) : (
                    `تعديل حالة السن ${selectedTooth >= 101 ? `اللبني رقم (${getToothLetter(selectedTooth)})` : `رقم (${getToothLetter(selectedTooth)})`} (${getToothArabicName(selectedTooth)})`
                  )}
                </h4>
                <p className="text-xs text-slate-400 font-bold">{getToothTypeName(getToothType(selectedTooth), isEn)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    const currentTooth = selectedTooth;
                    setMultiSelectedTeeth([currentTooth]);
                    setIsMultiSelectMode(true);
                    setSelectedTooth(null);
                  }}
                  className="px-3 py-1.5 bg-sky-100 hover:bg-sky-200 text-sky-800 border border-sky-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
                  title={isEn ? 'Convert to multi-tooth selection (Bridge/Denture/Ortho)' : 'تحويل لتحديد أسنان متعددة مع هذا السن (جسر/متحرك/تركيبة)'}
                >
                  <span>{isEn ? '🔘 Select with other teeth (Bridge/Denture)' : '🔘 تحديده مع أسنان أخرى (جسر/تركيبة/متحرك)'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedTooth(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-rose-600 text-white hover:bg-rose-700 transition-all duration-150 cursor-pointer shadow-md active:scale-90"
                title={isEn ? 'Close' : 'إغلاق'}
              >
                <X className="h-4 w-4 stroke-[3]" />
              </button>
            </div>
          </div>

          {readOnly ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">{isEn ? 'Current Tooth Condition' : 'الحالة الطبية الحالية للسن'}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['healthy', 'decayed', 'filled', 'crown', 'bridge', 'implant', 'missing'] as const)
                      .filter((cond) => !(selectedTooth >= 101 && cond === 'implant'))
                      .map((cond) => (
                        <button
                          key={cond}
                          type="button"
                          onClick={() => setCondition(cond)}
                          className={`px-3 py-2 text-xs font-bold rounded-xl border ${isEn ? 'text-left' : 'text-right'} transition flex items-center justify-between ${
                            condition === cond
                              ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span>{getConditionLabel(cond, isEn).split(' ')[0]}</span>
                          {condition === cond && <Check className="h-3.5 w-3.5 text-indigo-600 shrink-0" />}
                        </button>
                      ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">{isEn ? 'Diagnostic Notes & Treatment History' : 'ملاحظات تشخيصية وتاريخ العلاج للسن'}</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={isEn ? 'Write diagnostic details, filling specifications, or next follow-up date...' : 'اكتب تفاصيل المشكلة الطبية أو مواصفات الحشو أو موعد المراجعة القادمة والمستلزمات...'}
                    rows={4}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSelectedTooth(null)}
                  className="px-4 py-2 text-slate-500 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold transition"
                >
                  {isEn ? 'Cancel' : 'تراجع'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Diagnostic Notes Top Bar */}
              <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80">
                <label className="block text-xs font-black text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <Info className="h-4 w-4 text-indigo-600" />
                  {isEn 
                    ? `Diagnostic notes & details for (${getToothName(selectedTooth, true)}) #${getToothLetter(selectedTooth)} (Optional)`
                    : `ملاحظات تشخيصية وتفاصيل خاصة بـ (${getToothArabicName(selectedTooth)}) #${getToothLetter(selectedTooth)} (اختياري)`}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={isEn ? 'Write diagnosis details, local anesthesia type, or follow-up notes...' : 'اكتب تفاصيل التشخيص، نوع البنج المستخدم، أو ملاحظات المتابعة القادمة...'}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800 shadow-2xs"
                />
              </div>

              {/* Redesigned Clean & Simple Tooth Procedure Selector */}
              <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden animate-fade-in">
                {/* Clean Header */}
                <div className="bg-slate-900 text-white p-4 sm:p-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl shrink-0">
                      <Stethoscope className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                      {multiSelectedTeeth.length > 1 ? (
                        <div>
                          <h5 className="font-black text-sm sm:text-base text-white flex flex-wrap items-center gap-2">
                            <span>{isEn ? `Select & apply procedure for (${multiSelectedTeeth.length} selected teeth)` : `تحديد وتطبيق الإجراء لـ (${multiSelectedTeeth.length} أسنان محددة)`}</span>
                            <span className="bg-sky-500/30 text-sky-200 border border-sky-400/50 px-2.5 py-0.5 rounded-full font-extrabold text-xs">
                              {multiSelectedTeeth.map(n => `#${convertToFDI(n)}`).join(', ')}
                            </span>
                          </h5>
                          <p className="text-xs text-slate-300 font-medium mt-0.5">
                            {isEn ? 'Choose a medical procedure from the list to automatically apply and save for all selected teeth' : 'اختر الإجراء الطبي من القائمة لتطبيقه وحفظه تلقائياً لجميع الأسنان المحددة'}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <h5 className="font-black text-sm sm:text-base text-white">
                            {isEn ? `Select procedure for (${getToothName(selectedTooth, true)}) #${getToothLetter(selectedTooth)}` : `تحديد الإجراء المطلوب لـ (${getToothArabicName(selectedTooth)}) #${getToothLetter(selectedTooth)}`}
                          </h5>
                          <p className="text-xs text-slate-300 font-medium mt-0.5">
                            {isEn ? 'Select a procedure from the list below to calculate price, set session, and update tooth chart' : 'اختر الإجراء من القائمة أدناه لحساب السعر وتجهيز الجلسة وتحديث رسم الضرس تلقائياً'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedTooth(null)}
                    className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                    title={isEn ? 'Close' : 'إغلاق'}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-4 sm:p-5 space-y-4">
                  {/* Category Filter Pills & Unified Services List */}
                  {(() => {
                    const defaultOrthoPresets = [
                      { id: 'ortho-def-0', name: isEn ? 'Specific Teeth Orthodontics' : 'تقويم أسنان محددة', price: 4000, condition: 'ortho' as const, category: isEn ? 'Orthodontics & Cosmetic' : 'تقويم وتجميل الأسنان' },
                      { id: 'ortho-def-1', name: isEn ? 'Full Orthodontic Braces (Both Arches)' : 'تركيب تقويم أسنان كامل (فكين)', price: 8000, condition: 'ortho' as const, category: isEn ? 'Orthodontics & Cosmetic' : 'تقويم وتجميل الأسنان' },
                      { id: 'ortho-def-2', name: isEn ? 'Metal Braces (Single Arch)' : 'تركيب تقويم معدني علوي/سفلي', price: 5000, condition: 'ortho' as const, category: isEn ? 'Orthodontics & Cosmetic' : 'تقويم وتجميل الأسنان' },
                      { id: 'ortho-def-3', name: isEn ? 'Clear Aligners (Invisalign)' : 'تقويم شفاف تجميلي (Invisalign)', price: 15000, condition: 'ortho' as const, category: isEn ? 'Orthodontics & Cosmetic' : 'تقويم وتجميل الأسنان' },
                      { id: 'ortho-def-4', name: isEn ? 'Orthodontic Adjustment Session' : 'جلسة شد ومعايرة تقويم', price: 500, condition: 'ortho' as const, category: isEn ? 'Orthodontics & Cosmetic' : 'تقويم وتجميل الأسنان' },
                      { id: 'ortho-def-5', name: isEn ? 'Debonding & Retainer Installation' : 'فك وإزالة تقويم وتثبيت', price: 1000, condition: 'healthy' as const, category: isEn ? 'Orthodontics & Cosmetic' : 'تقويم وتجميل الأسنان' }
                    ];

                    const allAvailableServices = [
                      ...servicesList,
                      ...defaultOrthoPresets.filter(p => !servicesList.some(s => s.name === p.name))
                    ];

                    const filteredServices = selectedCategoryFilter === 'all'
                      ? allAvailableServices
                      : allAvailableServices.filter(s => (s.category || (isEn ? 'General' : 'عام')) === selectedCategoryFilter);

                    return (
                      <>
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-100">
                          <span className={`text-xs font-black text-slate-500 shrink-0 ${isEn ? 'mr-1' : 'ml-1'}`}>
                            📁 {isEn ? 'Categories:' : 'الأقسام:'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedCategoryFilter('all')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                              selectedCategoryFilter === 'all'
                                ? 'bg-emerald-600 text-white shadow-3xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isEn ? 'All' : 'الكل'} ({allAvailableServices.length})
                          </button>
                          {categoriesList.map(cat => {
                            const count = allAvailableServices.filter(s => (s.category || (isEn ? 'General' : 'عام')) === cat).length;
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setSelectedCategoryFilter(cat)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                                  selectedCategoryFilter === cat
                                    ? 'bg-emerald-600 text-white shadow-3xs'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                              >
                                {cat} ({count})
                              </button>
                            );
                          })}
                        </div>

                        {/* Services Grid Selection */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 max-h-[280px] overflow-y-auto p-1">
                          {filteredServices.map((srv) => {
                            const isSelected = serviceInput === srv.name;
                            return (
                              <button
                                key={srv.id}
                                type="button"
                                onClick={() => {
                                  setServiceInput(srv.name);
                                  setPriceInput(srv.price);
                                  setCondition(srv.condition);
                                }}
                                className={`p-3 rounded-2xl ${isEn ? 'text-left' : 'text-right'} transition border flex items-center justify-between gap-2.5 cursor-pointer ${
                                  isSelected
                                    ? 'bg-emerald-50 border-2 border-emerald-600 shadow-2xs'
                                    : 'bg-white border-slate-200/90 hover:border-emerald-400 hover:bg-slate-50 text-slate-800'
                                }`}
                              >
                                <span className={`font-black text-xs leading-snug ${isSelected ? 'text-emerald-950' : 'text-slate-800'}`}>
                                  {srv.name}
                                </span>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={`font-mono font-black text-xs px-2.5 py-1 rounded-xl ${
                                    isSelected ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                  }`}>
                                    {srv.price.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                                  </span>
                                  {isSelected && (
                                    <span className="bg-emerald-600 text-white p-0.5 rounded-full shrink-0">
                                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}

                  {/* Selected Procedure Box */}
                  <div className="bg-slate-50 border border-slate-200/90 p-4 rounded-2xl space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                      <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                        <Receipt className="h-4 w-4 text-emerald-600" />
                        {isEn ? 'Session & Selected Procedure Details:' : 'تفاصيل الجلسة والإجراء المحدد:'}
                      </span>
                      <span className="text-xs font-bold text-slate-500">
                        {isEn ? 'Chart Condition:' : 'حالة الرسم البياني:'} <span className="text-emerald-700 font-black">{getConditionLabel(condition, isEn)}</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-6">
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">{isEn ? 'Service / Procedure Name' : 'اسم الخدمة المنفذة'}</label>
                        <input
                          type="text"
                          value={serviceInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setServiceInput(val);
                            setCondition(autoDetectCondition(val));
                          }}
                          placeholder={isEn ? 'Select procedure above or enter custom service...' : 'اختر إجراء من الأعلى أو اكتب خدمة مخصصة...'}
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-3xs"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[11px] font-extrabold text-slate-700">
                            {multiSelectedTeeth.length > 1 ? (isEn ? 'Price (EGP)' : 'السعر (ج.م)') : (isEn ? 'Amount Required (EGP)' : 'المبلغ المطلوب (ج.م)')}
                          </label>
                          {multiSelectedTeeth.length > 1 && (
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-600 font-bold">
                              <label className="flex items-center gap-0.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name="multiPriceTypeRadio"
                                  checked={multiPriceType === 'total'}
                                  onChange={() => setMultiPriceType('total')}
                                  className="accent-emerald-600"
                                />
                                <span>{isEn ? 'Total' : 'إجمالي'}</span>
                              </label>
                              <label className="flex items-center gap-0.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name="multiPriceTypeRadio"
                                  checked={multiPriceType === 'per_tooth'}
                                  onChange={() => setMultiPriceType('per_tooth')}
                                  className="accent-emerald-600"
                                />
                                <span>{isEn ? 'Per Tooth' : 'لكل سن'}</span>
                              </label>
                            </div>
                          )}
                        </div>
                        <input
                          type="number"
                          value={priceInput}
                          onChange={(e) => setPriceInput(Number(e.target.value))}
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black font-mono text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-3xs"
                        />
                        {multiSelectedTeeth.length > 1 && (
                          <div className="text-[10px] font-black text-emerald-700 mt-1 flex items-center justify-between">
                            <span>{isEn ? 'Calculated Total:' : 'الإجمالي المحسوب:'}</span>
                            <span className="font-mono text-xs">
                              {((multiPriceType === 'per_tooth' ? priceInput * multiSelectedTeeth.length : priceInput) || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">{isEn ? 'Chart Condition' : 'حالة الرسم البياني'}</label>
                        <select
                          value={condition}
                          onChange={(e) => setCondition(e.target.value as DentalTooth['condition'])}
                          className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer shadow-3xs"
                        >
                          <option value="filled">{isEn ? 'Filling (Filled)' : 'حشو (Filled)'}</option>
                          <option value="missing">{isEn ? 'Extracted / Missing' : 'خلع / مفقود (Missing)'}</option>
                          <option value="crown">{isEn ? 'Crown' : 'تلبيسة / طربوش (Crown)'}</option>
                          <option value="bridge">{isEn ? 'Fixed Bridge' : 'تركيبة / جسر ثابت (Fixed Bridge)'}</option>
                          <option value="denture">{isEn ? 'Removable Denture' : 'تركيبة متحركة (Removable Denture)'}</option>
                          <option value="implant">{isEn ? 'Implant' : 'زراعة (Implant)'}</option>
                          <option value="healthy">{isEn ? 'Healthy / Cleaning' : 'تنظيف / سليم (Healthy)'}</option>
                          <option value="decayed">{isEn ? 'Decayed' : 'تسوس (Decayed)'}</option>
                          <option value="ortho">{isEn ? 'Orthodontics (Ortho)' : 'تقويم أسنان (Ortho)'}</option>
                        </select>
                      </div>
                    </div>

                    {/* Quick Material Sub-Type Selector for Fillings and Crowns */}
                    {condition === 'filled' && (
                      <div className="p-3 bg-teal-50/80 border border-teal-200/80 rounded-xl space-y-1.5 animate-fade-in">
                        <span className="text-[11px] font-black text-teal-950 block">
                          {isEn ? 'Select filling type & material for chart visualization:' : 'اختر نوع وتفاصيل الحشو للرسم والتوضيح:'}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setServiceInput(isEn ? 'Full Root Canal Treatment (RCT)' : 'حشو عصب كامل (RCT)');
                              setPriceInput(1500);
                              setNotes(isEn ? 'Root canal filling and complete canal instrumentation' : 'حشو عصب و سحب جذور كامل');
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-rose-50 border border-rose-300 text-rose-900 rounded-lg text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-3xs"
                          >
                            <span className="w-2 h-2 rounded-full bg-rose-600"></span>
                            🧪 {isEn ? 'Full Root Canal (RCT)' : 'حشو عصب كامل (RCT)'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setServiceInput(isEn ? 'Cosmetic Composite Laser Filling' : 'حشو ليزر كومبوزيت تجميلي');
                              setPriceInput(600);
                              setNotes(isEn ? 'Tooth-colored cosmetic laser filling' : 'حشو ليزر تجميلي نفس لون السن');
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-teal-50 border border-teal-300 text-teal-900 rounded-lg text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-3xs"
                          >
                            <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                            ✨ {isEn ? 'Cosmetic Composite' : 'حشو كومبوزيت تجميلي'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setServiceInput(isEn ? 'Silver Amalgam Filling' : 'حشو أملجم فضي (Amalgam)');
                              setPriceInput(500);
                              setNotes(isEn ? 'Resistant metallic silver amalgam filling' : 'حشو أملجم فضي معدني مقاوم');
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-3xs"
                          >
                            <span className="w-2 h-2 rounded-full bg-slate-700"></span>
                            ⚙️ {isEn ? 'Silver Amalgam' : 'حشو أملجم فضي'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setServiceInput(isEn ? 'Ceramic Inlay / Cosmetic Filling' : 'حشو سيراميك / إينلاي تجميلي');
                              setPriceInput(1200);
                              setNotes(isEn ? 'Cosmetic porcelain ceramic inlay filling' : 'حشو سيراميك / إينلاي بورسلين تجميلي');
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-sky-50 border border-sky-300 text-sky-900 rounded-lg text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-3xs"
                          >
                            <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                            💎 {isEn ? 'Ceramic / Inlay' : 'حشو سيراميك / إينلاي'}
                          </button>
                        </div>
                      </div>
                    )}

                    {condition === 'crown' && (
                      <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl space-y-1.5 animate-fade-in">
                        <span className="text-[11px] font-black text-amber-950 block">
                          {isEn ? 'Select crown type & material for chart visualization:' : 'اختر نوع ونمط التلبيسة للرسم والتوضيح:'}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setServiceInput(isEn ? 'White Zirconia Crown' : 'تلبيسة زيركون بيضاء (Zirconia)');
                              setPriceInput(2500);
                              setNotes(isEn ? 'Cosmetic white porcelain zirconia crown' : 'تلبيسة زيركون بورسلين أبيض تجميلي');
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-sky-50 border border-sky-300 text-sky-950 rounded-lg text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-3xs"
                          >
                            <span className="w-2 h-2 rounded-full bg-sky-300 border border-sky-500"></span>
                            ⚪ {isEn ? 'White Zirconia / Porcelain' : 'زيركون / بورسلين أبيض'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setServiceInput(isEn ? '24k Gold Crown' : 'تلبيسة ذهبية (Gold Crown 24k)');
                              setPriceInput(4000);
                              setNotes(isEn ? '24k Gold crown cap' : 'تلبيسة طربوش ذهب 24k');
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-3xs"
                          >
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                            🪙 {isEn ? '24k Gold Crown' : 'تلبيسة ذهبية 24k'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setServiceInput(isEn ? 'PFM Metallic Crown' : 'تلبيسة فضية معدنية (PFM Crown)');
                              setPriceInput(1800);
                              setNotes(isEn ? 'PFM metallic crown (PFM/Chrome)' : 'تلبيسة فضية معدنية (PFM/Chrome)');
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-lg text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-3xs"
                          >
                            <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                            🔘 {isEn ? 'PFM / Metallic Crown' : 'تلبيسة فضية / معدنية'}
                          </button>
                        </div>
                      </div>
                    )}


                  </div>
                </div>

                {/* Bottom Actions Bar */}
                <div className="bg-slate-50 p-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedTooth(null)}
                      className="px-4 py-2.5 text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      {isEn ? 'Cancel' : 'إلغاء'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveTooth}
                      className="px-4 py-2.5 text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-3xs cursor-pointer"
                      title={isEn ? 'Update tooth color and status in chart without adding a financial session' : 'تحديث لون وحالة الضرس في الرسم فقط دون إضافة جلسة مالية'}
                    >
                      <span>{isEn ? '🎨 Update Chart Only' : '🎨 تحديث الرسم فقط'}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isSavingSession || !serviceInput.trim()}
                    onClick={handleSaveSessionAndTooth}
                    className="px-6 py-2.5 text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl text-xs sm:text-sm font-extrabold transition flex items-center gap-2 shadow-xs cursor-pointer"
                  >
                    <Check className="h-4 w-4 stroke-[3]" />
                    {isSavingSession 
                      ? (isEn ? 'Saving...' : 'جاري الحفظ...') 
                      : multiSelectedTeeth.length > 1 
                        ? (isEn ? `Apply & Record Session (${multiSelectedTeeth.length} teeth)` : `تطبيق وتوثيق الجلسة (${multiSelectedTeeth.length} أسنان)`) 
                        : (isEn ? 'Save to Sessions' : 'حفظ في الجلسات')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>


    </div>
  );
}
