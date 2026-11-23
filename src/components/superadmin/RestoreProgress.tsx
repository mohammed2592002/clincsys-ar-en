import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, X, AlertCircle, Download } from 'lucide-react';

export type StageKey = 'upload' | 'validate' | 'restore' | 'verify';
export type StageState = 'waiting' | 'running' | 'done' | 'error';

export interface ProgressStage {
  key: StageKey;
  state: StageState;
  detail?: string;
  pct?: number; // 0-100; undefined while running = indeterminate
}

export interface RestoreProgressState {
  source: 'local' | 'server';
  status: 'running' | 'completed' | 'failed';
  fileName: string;
  fileSizeLabel?: string;
  stages: ProgressStage[];
  error?: string;
  nothingWritten?: boolean;
  partialNote?: string;
  counts?: { labelKey: string; value: number }[];
  reportLines?: string[];
}

const TEAL = '#3C7F72';
const TEAL_DARK = '#2E6156';
const RED = '#B3261E';

function StageRow({ stage, index, isLast }: { stage: ProgressStage; index: number; isLast: boolean }) {
  const { t } = useTranslation();
  const icon =
    stage.state === 'done' ? (
      <span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: TEAL }}>
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    ) : stage.state === 'running' ? (
      <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white" style={{ borderColor: TEAL }}>
        <Loader2 className="h-4 w-4 animate-spin" style={{ color: TEAL }} />
      </span>
    ) : stage.state === 'error' ? (
      <span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: RED }}>
        <X className="h-4 w-4" strokeWidth={3} />
      </span>
    ) : (
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-bold text-slate-400">
        {index + 1}
      </span>
    );
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!isLast && <span className="absolute top-7 bottom-0 w-px bg-slate-200" style={{ insetInlineStart: '13.5px' }} />}
      <span className="relative z-10 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-bold ${stage.state === 'waiting' ? 'text-slate-400' : 'text-slate-800'}`}>
            {t(`superadmin.restoreProgress.stages.${stage.key}`)}
          </span>
          {stage.state === 'running' && typeof stage.pct === 'number' && (
            <span className="text-xs font-bold" style={{ color: TEAL_DARK }}>{Math.round(stage.pct)}%</span>
          )}
        </div>
        {stage.detail && (
          <p className={`mt-0.5 text-xs ${stage.state === 'error' ? 'font-semibold' : 'text-slate-500'}`} style={stage.state === 'error' ? { color: RED } : undefined}>
            {stage.detail}
          </p>
        )}
        {stage.state === 'running' && (
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${typeof stage.pct === 'number' ? 'transition-all duration-500' : 'animate-pulse'}`}
              style={{ background: TEAL, width: `${typeof stage.pct === 'number' ? Math.max(4, stage.pct) : 40}%` }}
            />
          </div>
        )}
      </div>
    </li>
  );
}

export function RestoreProgressChip({ progress, onOpen, onDismiss }: { progress: RestoreProgressState; onOpen: () => void; onDismiss: () => void }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');
  const running = progress.status === 'running';
  const runningStage = progress.stages.find(s => s.state === 'running');
  const subtitle = runningStage
    ? `${t(`superadmin.restoreProgress.stages.${runningStage.key}`)}${runningStage.detail ? ` · ${runningStage.detail}` : ''}${typeof runningStage.pct === 'number' ? ` · ${Math.round(runningStage.pct)}%` : ''}`
    : progress.status === 'completed'
      ? t('superadmin.restoreProgress.completedTitle')
      : t('superadmin.restoreProgress.failedTitle');
  return (
    <div dir={isEn ? 'ltr' : 'rtl'} className="rounded-2xl border p-4 shadow-sm" style={{ borderColor: running ? TEAL : progress.status === 'failed' ? RED : TEAL, background: running ? '#F2F8F6' : progress.status === 'failed' ? '#FDF3F2' : '#F2F8F6' }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {running ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin" style={{ color: TEAL }} />
          ) : progress.status === 'completed' ? (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white" style={{ background: TEAL }}><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0" style={{ color: RED }} />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-slate-800">{progress.fileName}</p>
            <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onOpen} className="rounded-xl px-3.5 py-2 text-xs font-bold text-white transition hover:opacity-90" style={{ background: TEAL }}>
            {t('superadmin.restoreProgress.viewProgress')}
          </button>
          {!running && (
            <button type="button" onClick={onDismiss} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-50">
              {t('superadmin.restoreProgress.dismiss')}
            </button>
          )}
        </div>
      </div>
      {running && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/70">
          <div className={`h-full rounded-full ${typeof runningStage?.pct === 'number' ? 'transition-all duration-500' : 'animate-pulse'}`} style={{ background: TEAL, width: `${typeof runningStage?.pct === 'number' ? Math.max(4, runningStage.pct) : 40}%` }} />
        </div>
      )}
    </div>
  );
}

export function RestoreProgressWindow({ progress, onBackground, onClose }: { progress: RestoreProgressState; onBackground: () => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');
  const running = progress.status === 'running';
  const downloadReport = () => {
    const lines = progress.reportLines?.length
      ? progress.reportLines
      : [
          `Restore report - ${progress.fileName}`,
          `Status: ${progress.status}`,
          ...progress.stages.map(s => `${s.key}: ${s.state}${s.detail ? ` (${s.detail})` : ''}`),
          ...(progress.error ? [`Error: ${progress.error}`] : []),
          ...(progress.counts || []).map(c => `${c.labelKey}: ${c.value}`),
        ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `restore-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6" role="dialog" aria-modal="true">
      <div dir={isEn ? 'ltr' : 'rtl'} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 p-5">
          <h3 className="text-base font-bold text-slate-800">
            {running ? t('superadmin.restoreProgress.runningTitle') : progress.status === 'completed' ? t('superadmin.restoreProgress.completedTitle') : t('superadmin.restoreProgress.failedTitle')}
          </h3>
          <p className="mt-1 truncate text-xs text-slate-500" style={{ direction: 'ltr', textAlign: isEn ? 'left' : 'right' }}>
            {progress.fileName}{progress.fileSizeLabel ? ` · ${progress.fileSizeLabel}` : ''}
          </p>
        </div>
        <div className="p-5">
          <ol>
            {progress.stages.map((s, i) => (
              <React.Fragment key={s.key}><StageRow stage={s} index={i} isLast={i === progress.stages.length - 1} /></React.Fragment>
            ))}
          </ol>
          {progress.status === 'failed' && (
            <div className="mt-4 space-y-2 rounded-xl border p-3.5 text-xs" style={{ borderColor: '#F3C1BE', background: '#FDF3F2', color: RED }}>
              <div className="flex items-start gap-2 font-bold">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{progress.error}</span>
              </div>
              {progress.nothingWritten && (
                <p className="font-semibold" style={{ color: TEAL_DARK }}>{t('superadmin.restoreProgress.nothingWritten')}</p>
              )}
              {progress.partialNote && <p className="font-semibold text-slate-600">{progress.partialNote}</p>}
            </div>
          )}
          {progress.status === 'completed' && progress.counts && progress.counts.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold text-slate-600">{t('superadmin.restoreProgress.countsTitle')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {progress.counts.map(c => (
                  <div key={c.labelKey} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-center">
                    <div className="text-sm font-extrabold" style={{ color: TEAL_DARK }}>{c.value.toLocaleString(isEn ? 'en-US' : 'ar-EG-u-nu-latn')}</div>
                    <div className="mt-0.5 text-[10px] font-semibold text-slate-500">{t(c.labelKey)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          {running ? (
            <>
              <p className="text-[11px] text-slate-500">{t('superadmin.restoreProgress.backgroundNote')}</p>
              <button type="button" onClick={onBackground} className="shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90" style={{ background: TEAL }}>
                {t('superadmin.restoreProgress.continueBackground')}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={downloadReport} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
                <Download className="h-3.5 w-3.5" />
                {t('superadmin.restoreProgress.downloadReport')}
              </button>
              <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90" style={{ background: TEAL }}>
                {t('superadmin.restoreProgress.close')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
