import React from 'react';
import { getToothInfo } from '../utils';

interface ToothBadgeProps {
  tooth: number | string | null | undefined;
  className?: string;
  showTextLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const ToothBadge: React.FC<ToothBadgeProps> = ({
  tooth,
  className = '',
  showTextLabel = true,
  size = 'md'
}) => {
  if (tooth === null || tooth === undefined || tooth === '') return null;

  const info = getToothInfo(tooth);
  if (!info || !info.raw) return null;

  if (info.isChild) {
    return (
      <span
        className={`inline-flex items-center gap-1 font-bold rounded-lg border transition-all ${
          size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
        } bg-emerald-50/90 text-emerald-900 border-emerald-300/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700/60 shadow-2xs ${className}`}
        title={`سن لبني - نظام بالمر: ${info.palmerLetter} (${info.displayFormatted})`}
      >
        {showTextLabel && (
          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold opacity-90 select-none">
            سن لبني
          </span>
        )}
        <span
          className={`inline-flex items-center justify-center font-black leading-none text-emerald-800 dark:text-emerald-300 bg-white dark:bg-slate-900 rounded-2xs border-emerald-600 dark:border-emerald-500 font-sans ${
            info.borderClass
          } ${
            size === 'sm' ? 'w-4 h-4 text-[11px] p-0.5' : 'w-5 h-5 text-xs p-0.5'
          }`}
        >
          {info.palmerLetter}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 font-bold rounded-lg border font-mono transition-all ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
      } bg-indigo-50/90 text-indigo-900 border-indigo-200/80 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/60 shadow-2xs ${className}`}
      title={`ضرس بالغة - نظام FDI: #${info.fdi}`}
    >
      {showTextLabel && (
        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold opacity-90 select-none font-sans">
          ضرس
        </span>
      )}
      <span className="font-extrabold text-indigo-700 dark:text-indigo-300">
        #{info.fdi}
      </span>
    </span>
  );
};
