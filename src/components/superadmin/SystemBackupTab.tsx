import { backupRequest } from '../../utils/backupTransport';
import { authHeaders } from '../../dbClient';
import { RestoreProgressChip, RestoreProgressWindow, RestoreProgressState, ProgressStage } from './RestoreProgress';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef } from 'react';
import { Clinic } from '../../types';
import { useDialogs } from '../DialogContext';
import { downloadSystemBackupGz } from '../../utils/backupService';
import {
  Database,
  Download,
  Upload,
  HardDrive,
  Clock,
  ShieldAlert,
  Building2,
  FileArchive,
  AlertCircle,
} from 'lucide-react';

interface SystemBackupTabProps {
  clinics: Clinic[];
  onRefreshClinics: () => Promise<void>;
}

export default function SystemBackupTab({ clinics, onRefreshClinics }: SystemBackupTabProps) {
  const dialogs = useDialogs();
  const { t, i18n } = useTranslation();

  // Restore progress window / background chip (mockup-approved UX)
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgressState | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const activeJobRef = useRef<string | null>(null);
  const restoreFileNameRef = useRef<string | null>(null);

  const fmtSize = (bytes: number) => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MiB' : Math.round(bytes / 1024) + ' KiB';
  const fmtSecs = (ms: number) => (ms / 1000).toFixed(1);

  const mapServerJob = (job: any): RestoreProgressState => {
    const total = Number(job.totalClinics) || Number(job.validatedClinics) || 1;
    const done = job.state === 'completed';
    const failed = job.state === 'failed';
    const validating = job.state === 'validating';
    const restoring = job.state === 'restoring';
    const cDetail = (n: number) => t('superadmin.restoreProgress.clinicOf', { n, total });
    const stages: ProgressStage[] = [
      { key: 'upload', state: 'done', detail: t('superadmin.restoreProgress.doneInSecs', { s: fmtSecs(job.uploadMs || 0) }) },
      { key: 'validate', state: validating ? 'running' : 'done', detail: validating ? cDetail(job.validatedClinics || 0) : t('superadmin.restoreProgress.doneInSecs', { s: fmtSecs(job.validationMs || 0) }), pct: validating ? (100 * (job.validatedClinics || 0)) / total : undefined },
      { key: 'restore', state: restoring ? 'running' : done ? 'done' : 'waiting', detail: restoring ? cDetail(job.completedClinics || 0) : done ? t('superadmin.restoreProgress.clinicsWritten', { n: job.completedClinics }) : t('superadmin.restoreProgress.waitingValidate'), pct: restoring ? (100 * (job.completedClinics || 0)) / total : undefined },
      { key: 'verify', state: done ? 'done' : restoring && (job.completedClinics || 0) >= total ? 'running' : 'waiting', detail: done ? t('superadmin.restoreProgress.verifyDone') : t('superadmin.restoreProgress.verifyHint') },
    ];
    if (failed) {
      const idx = job.state === 'validating' ? 1 : 2;
      for (let i = idx; i < 4; i++) stages[i] = { ...stages[i], state: i === idx ? 'error' : 'waiting', detail: i === idx ? job.errors?.[0] : t('superadmin.restoreProgress.notStarted') };
    }
    const counts = done && job.verifiedCounts ? [
      { labelKey: 'superadmin.restoreProgress.count.clinics', value: job.completedClinics },
      { labelKey: 'superadmin.restoreProgress.count.patients', value: job.verifiedCounts.patients },
      { labelKey: 'superadmin.restoreProgress.count.appointments', value: job.verifiedCounts.appointments },
      { labelKey: 'superadmin.restoreProgress.count.prescriptions', value: job.verifiedCounts.prescriptions },
      { labelKey: 'superadmin.restoreProgress.count.shifts', value: job.verifiedCounts.shifts },
      { labelKey: 'superadmin.restoreProgress.count.receipts', value: job.verifiedCounts.finance_receipts },
      { labelKey: 'superadmin.restoreProgress.count.subscriptions', value: job.verifiedCounts.renewals },
    ].filter(c => typeof c.value === 'number') : undefined;
    return {
      source: 'server',
      status: done ? 'completed' : failed ? 'failed' : 'running',
      fileName: restoreFileNameRef.current || 'full-system-backup.json.gz',
      fileSizeLabel: job.uploadedBytes ? fmtSize(job.uploadedBytes) : undefined,
      stages,
      error: failed ? job.errors?.[0] : undefined,
      nothingWritten: failed && (job.completedClinics || 0) === 0,
      partialNote: failed && (job.completedClinics || 0) > 0 ? t('superadmin.restoreProgress.partialNote', { n: job.completedClinics }) : undefined,
      counts,
      reportLines: [
        `System restore job ${job.id}`,
        `Status: ${job.state}`,
        `Upload: ${fmtSecs(job.uploadMs || 0)}s (${job.uploadedBytes} bytes)`,
        `Validation: ${fmtSecs(job.validationMs || 0)}s (${job.validatedClinics}/${total})`,
        `Restore: ${fmtSecs(job.restoreMs || 0)}s (${job.completedClinics}/${total})`,
        `Total: ${fmtSecs(job.totalMs || 0)}s`,
        `Peak process RSS: ${fmtSize(job.peakRssBytes || 0)}`,
        `Min free host RAM: ${fmtSize(job.minFreeHostBytes || 0)}`,
        ...(job.superadminCredentialsReplaced ? ['Superadmin credentials replaced from file'] : []),
        ...(job.errors || []).map((e: string) => `Error: ${e}`),
        ...(job.verifiedCounts ? Object.entries(job.verifiedCounts).map(([k, v]) => `${k}: ${v}`) : []),
      ],
    };
  };

  // Watch server-side restore jobs: the active one closely, the latest one passively.
  useEffect(() => {
    let stop = false;
    let timer: any;
    const poll = async () => {
      try {
        const active = activeJobRef.current;
        const r = await fetch(active ? '/api/system-restore/' + active : '/api/system-restore', { headers: { ...authHeaders() } as any });
        if (r.ok) {
          const job = await r.json();
          const running = job.state === 'uploading' || job.state === 'validating' || job.state === 'restoring';
          const recent = running || (job.finishedAt && Date.now() - Date.parse(job.finishedAt) < 30 * 60 * 1000);
          if (recent && !stop) setRestoreProgress(mapServerJob(job));
          if (active && !running) activeJobRef.current = null;
        } else if (activeJobRef.current && r.status === 404) {
          activeJobRef.current = null;
        }
      } catch { /* unreachable: no chip */ }
      if (!stop) timer = setTimeout(poll, activeJobRef.current ? 2000 : 5000);
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  // Export state
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupStatusText, setBackupStatusText] = useState('');
  const [lastFullBackup, setLastFullBackup] = useState<{ date: string; size: number } | null>(() => {
    try { return JSON.parse(localStorage.getItem('auto_backup_admin_last_full') || 'null'); } catch { return null; }
  });
  const [selectedSingleClinicId, setSelectedSingleClinicId] = useState<string>('');

  // Auto backup (daily reminder download, unified format)
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(() => localStorage.getItem('auto_backup_admin_enabled') === 'true');
  const [lastAutoBackupDate, setLastAutoBackupDate] = useState<string>(() => localStorage.getItem('auto_backup_admin_last_date') || '');

  // Restore state
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const [restoreConfirmInput, setRestoreConfirmInput] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [restoreHistory, setRestoreHistory] = useState<{ name: string; date: string; ok: boolean; clinics: number }[]>(() => {
    try { return JSON.parse(localStorage.getItem('ub_restore_history') || '[]'); } catch { return []; }
  });
  const pushHistory = (entry: { name: string; date: string; ok: boolean; clinics: number }) => {
    setRestoreHistory(prev => {
      const next = [entry, ...prev].slice(0, 5);
      localStorage.setItem('ub_restore_history', JSON.stringify(next));
      return next;
    });
  };

  const handleToggleAutoBackup = () => {
    const next = !autoBackupEnabled;
    setAutoBackupEnabled(next);
    localStorage.setItem('auto_backup_admin_enabled', next ? 'true' : 'false');
    dialogs.alert(next ? t('superadmin.unifiedBackup.autoOnAlert') : t('superadmin.unifiedBackup.autoOffAlert'), { severity: 'success' });
  };

  // Single full-system download, unified .json.gz format
  const handleFullSystemBackup = async () => {
    setBackupLoading(true);
    setBackupStatusText(t('superadmin.unifiedBackup.preparingDownload'));
    try {
      const { fileName, size } = await downloadSystemBackupGz();
      const record = { date: new Date().toISOString(), size };
      localStorage.setItem('auto_backup_admin_last_full', JSON.stringify(record));
      localStorage.setItem('auto_backup_admin_last_date', record.date.split('T')[0]);
      setLastFullBackup(record);
      setLastAutoBackupDate(record.date.split('T')[0]);
      dialogs.alert(t('superadmin.unifiedBackup.exportSuccess', { name: fileName, size: fmtSize(size) }), { severity: 'success' });
    } catch (err: any) {
      console.error('Super Admin Backup Error:', err);
      dialogs.alert(t('superadmin.unifiedBackup.exportError') + ' ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setBackupLoading(false);
      setBackupStatusText('');
    }
  };

  // Single clinic export (fixed .json)
  const handleSingleClinicExportFromDropdown = async () => {
    if (!selectedSingleClinicId) {
      dialogs.alert(t('superadmin.unifiedBackup.chooseClinicFirst'), { severity: 'warning' });
      return;
    }
    const clinic = clinics.find(c => c.id === selectedSingleClinicId);
    if (!clinic) return;
    setBackupLoading(true);
    setBackupStatusText(t('superadmin.unifiedBackup.downloadingClinic', { name: clinic.name }));
    try {
      const clinicBackup = await backupRequest({ action: 'export_clinic', clinicId: clinic.id });
      const dateStr = new Date().toISOString().split('T')[0];
      const safeName = (clinic.name || 'Clinic').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
      const blob = new Blob([JSON.stringify(clinicBackup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BACKUP_${safeName}_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
      dialogs.alert(t('superadmin.unifiedBackup.clinicExportSuccess', { name: clinic.name }), { severity: 'success' });
    } catch (err: any) {
      dialogs.alert(t('superadmin.unifiedBackup.exportError') + ' ' + err.toString(), { severity: 'error' });
    } finally {
      setBackupLoading(false);
      setBackupStatusText('');
    }
  };

  // Step 1: select a .json.gz file and open the critical confirmation modal
  const acceptRestoreFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json.gz')) {
      dialogs.alert(t('superadmin.unifiedBackup.fileRejected'), { severity: 'error' });
      return;
    }
    setPendingRestoreFile(file);
    setRestoreConfirmInput('');
    setRestoreError('');
  };
  const handleSelectRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptRestoreFile(e.target.files?.[0]);
    e.target.value = '';
  };

  // Step 2: stream the file to the unified restore route after typing RESTORE
  const handleExecuteConfirmedRestore = async () => {
    const trimmed = restoreConfirmInput.trim().toUpperCase();
    if (trimmed !== 'RESTORE' && trimmed !== 'استعادة') {
      setRestoreError(t('superadmin.unifiedBackup.confirmError'));
      return;
    }
    if (!pendingRestoreFile) return;
    const fileToRestore = pendingRestoreFile;
    setPendingRestoreFile(null);
    setBackupLoading(true);

    const starting: RestoreProgressState = {
      source: 'server',
      status: 'running',
      fileName: fileToRestore.name,
      fileSizeLabel: fmtSize(fileToRestore.size),
      stages: [
        { key: 'upload', state: 'running', detail: fmtSize(fileToRestore.size) },
        { key: 'validate', state: 'waiting', detail: t('superadmin.restoreProgress.waitingUpload') },
        { key: 'restore', state: 'waiting', detail: t('superadmin.restoreProgress.waitingValidate') },
        { key: 'verify', state: 'waiting', detail: t('superadmin.restoreProgress.verifyHint') },
      ],
    };
    setRestoreProgress(starting);
    setProgressOpen(true);

    try {
      const res = await fetch('/api/system-restore', {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/gzip' } as any,
        body: fileToRestore,
      });
      const launch = await res.json().catch(() => ({}));
      if (res.status !== 202 || !launch.id) throw new Error(launch.message || 'Restore launch failed');
      activeJobRef.current = launch.id;
      restoreFileNameRef.current = fileToRestore.name;
      // The poller picks the job up and drives the window from real server state.
    } catch (err: any) {
      const msg = err.message || err.toString();
      setRestoreProgress({
        ...starting,
        status: 'failed',
        stages: [
          { key: 'upload', state: 'error', detail: msg },
          { key: 'validate', state: 'waiting', detail: t('superadmin.restoreProgress.notStarted') },
          { key: 'restore', state: 'waiting', detail: t('superadmin.restoreProgress.notStarted') },
          { key: 'verify', state: 'waiting', detail: t('superadmin.restoreProgress.notStarted') },
        ],
        error: msg,
        nothingWritten: true,
      });
      pushHistory({ name: fileToRestore.name, date: new Date().toISOString(), ok: false, clinics: 0 });
    } finally {
      setBackupLoading(false);
    }
  };

  // Record history when the active job reaches a terminal state
  useEffect(() => {
    if (!restoreProgress || restoreProgress.source !== 'server') return;
    if (restoreProgress.status === 'completed' || restoreProgress.status === 'failed') {
      const name = restoreProgress.fileName || 'backup.json.gz';
      const already = restoreHistory[0];
      const clinics = restoreProgress.counts?.find(c => c.labelKey.endsWith('clinics'))?.value || 0;
      if (!already || already.name !== name || already.ok !== (restoreProgress.status === 'completed')) {
        if (restoreProgress.fileName && restoreProgress.fileName !== 'full-system-backup.json.gz')
          pushHistory({ name, date: new Date().toISOString(), ok: restoreProgress.status === 'completed', clinics });
      }
      if (restoreProgress.status === 'completed') onRefreshClinics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreProgress?.status]);

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString(i18n.language?.startsWith('en') ? 'en-GB' : 'ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
  };

  const stageList = [
    t('superadmin.restoreProgress.stages.upload'),
    t('superadmin.restoreProgress.stages.validate'),
    t('superadmin.restoreProgress.stages.restore'),
    t('superadmin.restoreProgress.stages.verify'),
  ];

  return (
    <div className="space-y-6" dir={i18n.dir()}>
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Database className="h-6 w-6 text-[#3C7F72]" />
            {t('superadmin.unifiedBackup.title')}
          </h2>
          <p className="text-sm text-slate-500 mt-1">{t('superadmin.unifiedBackup.subtitle')}</p>
        </div>
        <span className="self-start md:self-center text-[11px] font-bold text-[#2E6156] bg-[#3C7F72]/10 border border-[#3C7F72]/20 px-2.5 py-1 rounded-lg">
          {t('superadmin.unifiedBackup.oneFormatNote')}
        </span>
      </div>

      {backupLoading && backupStatusText && (
        <div className="bg-[#3C7F72]/5 p-4 rounded-2xl border border-[#3C7F72]/20 text-xs font-bold text-[#2E6156]">
          {backupStatusText}
        </div>
      )}

      {restoreProgress && !progressOpen && (
        <RestoreProgressChip progress={restoreProgress} onOpen={() => setProgressOpen(true)} onDismiss={() => setRestoreProgress(null)} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ================= EXPORT CARD ================= */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#3C7F72]/10 text-[#3C7F72] font-bold flex items-center justify-center border border-[#3C7F72]/20">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <span className="text-[10px] font-extrabold tracking-widest text-[#3C7F72]">{t('superadmin.unifiedBackup.tagExport')}</span>
                <h3 className="text-base font-bold text-slate-800">{t('superadmin.unifiedBackup.exportTitle')}</h3>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold font-mono text-[#2E6156] bg-[#3C7F72]/10 border border-[#3C7F72]/20 px-2.5 py-1 rounded-lg">
                <FileArchive className="h-3.5 w-3.5" />
                {t('superadmin.unifiedBackup.formatChip')}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {lastFullBackup
                ? t('superadmin.unifiedBackup.lastBackup', { date: fmtDate(lastFullBackup.date), size: fmtSize(lastFullBackup.size) })
                : t('superadmin.unifiedBackup.lastBackupNever')}
            </p>
          </div>
          <button
            id="btn-download-full-system-backup"
            disabled={backupLoading}
            onClick={handleFullSystemBackup}
            className="w-full py-3 bg-[#3C7F72] hover:bg-[#2E6156] text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 text-xs"
          >
            <Download className="h-4 w-4" />
            {backupLoading ? t('superadmin.unifiedBackup.downloading') : t('superadmin.unifiedBackup.downloadFull')}
          </button>
        </div>

        {/* ================= RESTORE CARD ================= */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#3C7F72]/10 text-[#3C7F72] font-bold flex items-center justify-center border border-[#3C7F72]/20">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[10px] font-extrabold tracking-widest text-[#3C7F72]">{t('superadmin.unifiedBackup.tagRestore')}</span>
              <h3 className="text-base font-bold text-slate-800">{t('superadmin.unifiedBackup.restoreTitle')}</h3>
            </div>
          </div>

          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptRestoreFile(e.dataTransfer.files?.[0]); }}
            className={`w-full min-h-[92px] px-4 py-4 bg-white border-2 border-dashed rounded-xl transition cursor-pointer flex flex-col items-center justify-center gap-1.5 text-xs font-bold ${dragOver ? 'border-[#3C7F72] bg-[#3C7F72]/5 text-[#2E6156]' : 'border-slate-300 hover:border-[#3C7F72] text-slate-600'}`}
          >
            <Upload className="h-5 w-5 text-[#3C7F72]" />
            {t('superadmin.unifiedBackup.dropOrChoose')}
            <span className="text-[10px] font-semibold text-slate-400">{t('superadmin.unifiedBackup.acceptsOnly')}</span>
            <input type="file" accept=".json.gz" className="hidden" onChange={handleSelectRestoreFile} />
          </label>

          <p className="text-[11px] font-bold text-[#B3261E]">{t('superadmin.unifiedBackup.oldFormatsDropped')}</p>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 space-y-1.5">
            <div className="text-[11px] font-bold text-slate-700">{t('superadmin.unifiedBackup.stagesTitle')}</div>
            <ol className="text-[11px] text-slate-500 space-y-1 list-none">
              {stageList.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full bg-[#3C7F72]/10 text-[#2E6156] text-[9px] font-extrabold flex items-center justify-center shrink-0">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="text-[10px] text-slate-400">{t('superadmin.unifiedBackup.uploadOpensWindow')}</p>
          </div>

          <div className="text-[11px] text-slate-500 space-y-1">
            <span className="font-bold text-slate-700">{t('superadmin.unifiedBackup.historyTitle')}</span>
            {restoreHistory.length === 0 ? (
              <p className="text-slate-400">{t('superadmin.unifiedBackup.historyEmpty')}</p>
            ) : (
              restoreHistory.slice(0, 3).map((h, i) => (
                <p key={i} className="font-mono text-[10px] text-slate-500">
                  {h.ok ? '✓' : '✗'} {h.name} · {fmtDate(h.date)}{h.clinics ? ` · ${t('superadmin.restoreProgress.clinicsWritten', { n: h.clinics })}` : ''}
                </p>
              ))
            )}
          </div>
        </div>

        {/* ================= AUTO BACKUP CARD ================= */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#3C7F72]/10 text-[#3C7F72] font-bold flex items-center justify-center border border-[#3C7F72]/20">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <span className="text-[10px] font-extrabold tracking-widest text-[#3C7F72]">{t('superadmin.unifiedBackup.tagAuto')}</span>
                <h3 className="text-base font-bold text-slate-800">{t('superadmin.unifiedBackup.autoTitle')}</h3>
              </div>
            </div>
            <button
              onClick={handleToggleAutoBackup}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition cursor-pointer ${autoBackupEnabled ? 'bg-[#3C7F72] justify-end' : 'bg-slate-300 justify-start'}`}
            >
              <div className="bg-white w-4 h-4 rounded-full shadow-md" />
            </button>
          </div>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3 text-xs text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <span>{t('superadmin.unifiedBackup.autoFormat')}</span>
              <span className="text-[11px] font-bold font-mono text-[#2E6156] bg-[#3C7F72]/10 border border-[#3C7F72]/20 px-2 py-0.5 rounded-md">{t('superadmin.unifiedBackup.formatChip')}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>{t('superadmin.unifiedBackup.autoStatus')}</span>
              <span className={`font-bold ${autoBackupEnabled ? 'text-[#2E6156]' : 'text-slate-400'}`}>
                {autoBackupEnabled ? t('superadmin.unifiedBackup.autoOn') : t('superadmin.unifiedBackup.autoOff')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>{t('superadmin.unifiedBackup.lastAuto')}</span>
              <span className="font-mono text-slate-800 font-bold">{lastAutoBackupDate || t('superadmin.unifiedBackup.lastBackupNever')}</span>
            </div>
          </div>
        </div>

        {/* ================= SINGLE CLINIC EXPORT CARD ================= */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#3C7F72]/10 text-[#3C7F72] font-bold flex items-center justify-center border border-[#3C7F72]/20">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">{t('superadmin.unifiedBackup.singleClinicTitle')}</h3>
                <p className="text-xs text-slate-500">{t('superadmin.unifiedBackup.singleClinicSubtitle')}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">{t('superadmin.unifiedBackup.chooseClinic')}</label>
              <select
                value={selectedSingleClinicId}
                onChange={(e) => setSelectedSingleClinicId(e.target.value)}
                className="w-full p-3 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-[#3C7F72] focus:outline-none"
              >
                <option value="">{t('superadmin.unifiedBackup.chooseClinicPlaceholder')}</option>
                {clinics.map(c => (
                  <option key={c.id} value={c.id}>{c.name} - ({c.doctorName || t('superadmin.unifiedBackup.noDoctor')})</option>
                ))}
              </select>
            </div>
          </div>
          <button
            disabled={backupLoading || !selectedSingleClinicId}
            onClick={handleSingleClinicExportFromDropdown}
            className="w-full py-3 bg-[#3C7F72] hover:bg-[#2E6156] text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 text-xs"
          >
            <Download className="h-4 w-4" />
            {t('superadmin.unifiedBackup.downloadClinic')}
          </button>
        </div>
      </div>

      {/* ================= CRITICAL 2-STEP RESTORE CONFIRMATION MODAL ================= */}
      {pendingRestoreFile && (
        <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border-2 border-rose-500 animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-3 bg-rose-100 rounded-xl">
                <ShieldAlert className="h-8 w-8 text-rose-600" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-rose-900">{t('superadmin.unifiedBackup.confirmTitle')}</h3>
                <p className="text-xs text-slate-500">{pendingRestoreFile.name}</p>
              </div>
            </div>
            <div className="p-4 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-900 space-y-2 leading-relaxed">
              <p className="font-bold">{t('superadmin.unifiedBackup.confirmWarningTitle')}</p>
              <p>{t('superadmin.unifiedBackup.confirmWarningBody')}</p>
              <p className="font-semibold text-rose-800">
                {t('superadmin.unifiedBackup.confirmTypePrefix')} <span className="font-mono bg-rose-200 px-1.5 py-0.5 rounded text-rose-950 font-bold">RESTORE</span>
              </p>
            </div>
            {restoreError && (
              <div className="p-3 bg-rose-100 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {restoreError}
              </div>
            )}
            <div>
              <input
                type="text"
                value={restoreConfirmInput}
                onChange={(e) => { setRestoreConfirmInput(e.target.value); setRestoreError(''); }}
                placeholder={t('superadmin.unifiedBackup.confirmPlaceholder')}
                className="w-full p-3 border-2 border-rose-300 rounded-xl text-center font-mono font-bold text-sm tracking-widest text-slate-900 focus:border-rose-600 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingRestoreFile(null)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition text-xs cursor-pointer"
              >
                {t('superadmin.unifiedBackup.cancel')}
              </button>
              <button
                type="button"
                disabled={backupLoading}
                onClick={handleExecuteConfirmedRestore}
                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-xl shadow-md transition text-xs cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {backupLoading ? t('superadmin.unifiedBackup.restoringNow') : t('superadmin.unifiedBackup.confirmButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreProgress && progressOpen && (
        <RestoreProgressWindow
          progress={restoreProgress}
          onBackground={() => setProgressOpen(false)}
          onClose={() => { setProgressOpen(false); if (restoreProgress.status !== 'running') setRestoreProgress(null); }}
        />
      )}
    </div>
  );
}
