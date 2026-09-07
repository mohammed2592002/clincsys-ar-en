import React, { useState, useEffect } from 'react';
import { db, doc, collection, setDoc, getDocsSmart as getDocs } from '../../dbClient';
import { Clinic } from '../../types';
import { useDialogs } from '../DialogContext';
import { getLocalTodayStr, createZipBlob, readBackupFile } from '../../utils/backupService';
import { 
  Database, 
  Download, 
  Upload, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  HardDrive, 
  Clock, 
  ShieldAlert, 
  FileText, 
  Building2, 
  Layers, 
  Check, 
  X,
  FileArchive
} from 'lucide-react';

interface SystemBackupTabProps {
  clinics: Clinic[];
  onRefreshClinics: () => Promise<void>;
}

export default function SystemBackupTab({ clinics, onRefreshClinics }: SystemBackupTabProps) {
  const dialogs = useDialogs();

  // Export Settings
  const [exportFormat, setExportFormat] = useState<'zip' | 'json' | 'sql' | 'db'>('zip');
  const [selectedSingleClinicId, setSelectedSingleClinicId] = useState<string>('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupStatusText, setBackupStatusText] = useState('');

  // Auto Backup Settings
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(() => {
    return localStorage.getItem('auto_backup_admin_enabled') === 'true';
  });
  const [autoBackupFormat, setAutoBackupFormat] = useState<'zip' | 'json' | 'sql' | 'db'>(() => {
    return (localStorage.getItem('auto_backup_admin_format') as 'zip' | 'json' | 'sql' | 'db') || 'zip';
  });
  const [lastAutoBackupDate, setLastAutoBackupDate] = useState<string>(() => {
    return localStorage.getItem('auto_backup_admin_last_date') || 'لم تتم بعد اليوم';
  });

  // Critical Restore Modal State
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const [restoreConfirmInput, setRestoreConfirmInput] = useState('');
  const [restoreError, setRestoreError] = useState('');

  const handleSaveAutoBackupSettings = (enabled: boolean, format: 'zip' | 'json' | 'sql' | 'db', notify: boolean = true) => {
    setAutoBackupEnabled(enabled);
    setAutoBackupFormat(format);
    localStorage.setItem('auto_backup_admin_enabled', enabled ? 'true' : 'false');
    localStorage.setItem('auto_backup_admin_format', format);

    if (notify) {
      dialogs.alert(
        enabled
          ? `تم تفعيل النسخ الاحتياطي التلقائي اليومي للسيستم كاملاً الساعة 12:00 منتصف الليل بصيغة (.${format}).`
          : `تم تحديث إعدادات النسخ التلقائي بصيغة (.${format}).`,
        { severity: 'success' }
      );
    }
  };

  // Safe Batched Full System Backup
  const handleFullSystemBackup = async (formatOverride?: 'zip' | 'json' | 'sql' | 'db', isAuto: boolean = false) => {
    const fmt = formatOverride || exportFormat;
    setBackupLoading(true);
    setBackupProgress(5);
    setBackupStatusText(isAuto ? 'جاري أخذ نسخة احتياطية دورية...' : 'جاري تجميع بيانات السيستم وكافة العيادات...');

    try {
      const dateStr = new Date().toISOString().split('T')[0];

      // 1. Fetch clinics list
      const clinicsSnap = await getDocs(collection(db, 'clinics'));
      const clinicDocs = clinicsSnap.docs;
      const totalClinics = clinicDocs.length;
      const allClinicsData: any[] = [];

      // Process clinics in sequential batches to prevent memory overflow
      for (let i = 0; i < totalClinics; i++) {
        const clinicDoc = clinicDocs[i];
        const cId = clinicDoc.id;
        const cData = { id: cId, ...clinicDoc.data() } as any;

        setBackupStatusText(`جاري جمع بيانات العيادة (${i + 1}/${totalClinics}): ${cData.name || cId}...`);
        setBackupProgress(Math.round(10 + (i / totalClinics) * 75));

        const [
          patientsSnap,
          appointmentsSnap,
          prescriptionsSnap,
          customMedSnap,
          customCatSnap,
          shiftsSnap,
          expensesSnap,
          inventorySnap,
          billingSnap,
          closingsSnap,
          labsSnap,
          labOrdersSnap,
          labWorkTypesSnap
        ] = await Promise.all([
          getDocs(collection(db, 'clinics', cId, 'patients')),
          getDocs(collection(db, 'clinics', cId, 'appointments')),
          getDocs(collection(db, 'clinics', cId, 'prescriptions')),
          getDocs(collection(db, 'clinics', cId, 'custom_medications')),
          getDocs(collection(db, 'clinics', cId, 'custom_categories')),
          getDocs(collection(db, 'clinics', cId, 'shifts')),
          getDocs(collection(db, 'clinics', cId, 'expenses')),
          getDocs(collection(db, 'clinics', cId, 'inventory')),
          getDocs(collection(db, 'clinics', cId, 'billing')),
          getDocs(collection(db, 'clinics', cId, 'closings')),
          getDocs(collection(db, 'clinics', cId, 'laboratories')),
          getDocs(collection(db, 'clinics', cId, 'lab_orders')),
          getDocs(collection(db, 'clinics', cId, 'lab_work_types'))
        ]);

        const patientsData = await Promise.all(
          patientsSnap.docs.map(async (pDoc) => {
            const pData = { id: pDoc.id, ...pDoc.data() } as any;
            const [recsSnap, teethSnap, xraysSnap] = await Promise.all([
              getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'records')),
              getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'teeth')),
              getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'xrays'))
            ]);
            return {
              ...pData,
              records: recsSnap.docs.map(r => ({ id: r.id, ...r.data() })),
              teeth: teethSnap.docs.map(t => ({ id: t.id, ...t.data() })),
              xrays: xraysSnap.docs.map(x => ({ id: x.id, ...x.data() }))
            };
          })
        );

        allClinicsData.push({
          clinicInfo: cData,
          patients: patientsData,
          appointments: appointmentsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          prescriptions: prescriptionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          customMedications: customMedSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          customCategories: customCatSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          shifts: shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          expenses: expensesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          inventory: inventorySnap.docs.map(d => ({ id: d.id, ...d.data() })),
          billing: billingSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          dailyClosings: closingsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          laboratories: labsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          labOrders: labOrdersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          labWorkTypes: labWorkTypesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        });
      }

      setBackupStatusText('جاري جلب سجل التجديدات وإعدادات المنظومة العامة...');
      setBackupProgress(90);

      // Fetch global logs & settings
      const [renewalsSnap, broadcastsSnap, systemSettingsSnap] = await Promise.all([
        getDocs(collection(db, 'renewals')),
        getDocs(collection(db, 'broadcasts')),
        getDocs(collection(db, 'system_settings'))
      ]);

      const fullSystemData = {
        platform: 'CrownDent Multi-Tenant System Master',
        backupScope: 'FULL_SYSTEM_BACKUP',
        backupTimestamp: new Date().toISOString(),
        totalClinicsCount: allClinicsData.length,
        renewalsLog: renewalsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        broadcasts: broadcastsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        systemSettings: systemSettingsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        clinics: allClinicsData
      };

      setBackupProgress(95);
      setBackupStatusText('جاري إنشاء ملف النسخة الاحتياطية وبدء التنزيل...');

      if (fmt === 'sql') {
        let sqlStr = `-- FULL SYSTEM MASTER ANSI SQL DUMP\n`;
        sqlStr += `-- Generated: ${new Date().toISOString()}\n`;
        sqlStr += `-- Total Clinics: ${allClinicsData.length}\n\n`;

        sqlStr += `CREATE TABLE IF NOT EXISTS system_clinics (id VARCHAR(255) PRIMARY KEY, name TEXT, doctor_name TEXT, email TEXT, created_at TEXT);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_patients (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), name TEXT, phone TEXT, age INT, medical_history TEXT);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_appointments (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), patient_id VARCHAR(255), patient_name TEXT, date TEXT, status TEXT, expected_cost NUMERIC);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_prescriptions (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), patient_id VARCHAR(255), patient_name TEXT, date TEXT, medications TEXT);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_billing (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), patient_id VARCHAR(255), total_amount NUMERIC, paid_amount NUMERIC, date TEXT);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_expenses (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), title TEXT, amount NUMERIC, category TEXT, payment_method TEXT, date TEXT, type TEXT);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_shifts (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), operator_name TEXT, opened_at TEXT, closed_at TEXT, total_revenue NUMERIC, expenses_total NUMERIC, status TEXT);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_inventory (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), name TEXT, quantity NUMERIC, min_quantity NUMERIC, unit TEXT, price NUMERIC);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_daily_closings (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), closing_date TEXT, total_income NUMERIC, total_expenses NUMERIC, net_income NUMERIC);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_laboratories (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), name TEXT, phone TEXT, address TEXT);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_lab_orders (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), lab_id TEXT, lab_name TEXT, patient_name TEXT, order_type TEXT, cost NUMERIC, paid NUMERIC, status TEXT, sent_date TEXT, delivery_date TEXT);\n`;
        sqlStr += `CREATE TABLE IF NOT EXISTS system_staff (id VARCHAR(255) PRIMARY KEY, clinic_id VARCHAR(255), name TEXT, role TEXT, phone TEXT, email TEXT, allowed_tabs TEXT);\n\n`;

        const escapeSQLVal = (val: any): string => {
          if (val === undefined || val === null) return 'NULL';
          if (typeof val === 'number') return val.toString();
          const clean = val.toString().replace(/'/g, "''");
          return `'${clean}'`;
        };

        allClinicsData.forEach(c => {
          const info = c.clinicInfo;
          sqlStr += `INSERT INTO system_clinics VALUES (${escapeSQLVal(info.id)}, ${escapeSQLVal(info.name)}, ${escapeSQLVal(info.doctorName)}, ${escapeSQLVal(info.email)}, ${escapeSQLVal(info.createdAt)});\n`;

          c.patients.forEach((p: any) => {
            sqlStr += `INSERT INTO system_patients VALUES (${escapeSQLVal(p.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(p.name)}, ${escapeSQLVal(p.phone)}, ${escapeSQLVal(p.age)}, ${escapeSQLVal(p.medicalHistory)});\n`;
          });

          c.appointments.forEach((app: any) => {
            sqlStr += `INSERT INTO system_appointments VALUES (${escapeSQLVal(app.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(app.patientId)}, ${escapeSQLVal(app.patientName)}, ${escapeSQLVal(app.date)}, ${escapeSQLVal(app.status)}, ${Number(app.expectedCost) || 0});\n`;
          });

          c.prescriptions.forEach((pres: any) => {
            const medsStr = Array.isArray(pres.medications) ? pres.medications.map((m: any) => `${m.name} (${m.dosage})`).join(' | ') : (pres.medicationsText || '');
            sqlStr += `INSERT INTO system_prescriptions VALUES (${escapeSQLVal(pres.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(pres.patientId)}, ${escapeSQLVal(pres.patientName)}, ${escapeSQLVal(pres.date)}, ${escapeSQLVal(medsStr)});\n`;
          });

          c.billing.forEach((b: any) => {
            sqlStr += `INSERT INTO system_billing VALUES (${escapeSQLVal(b.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(b.patientId)}, ${Number(b.totalAmount) || 0}, ${Number(b.paidAmount) || 0}, ${escapeSQLVal(b.date)});\n`;
          });

          if (Array.isArray(c.expenses)) {
            c.expenses.forEach((exp: any) => {
              sqlStr += `INSERT INTO system_expenses VALUES (${escapeSQLVal(exp.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(exp.title)}, ${Number(exp.amount) || 0}, ${escapeSQLVal(exp.category)}, ${escapeSQLVal(exp.paymentMethod || 'كاش')}, ${escapeSQLVal(exp.date)}, ${escapeSQLVal(exp.type || 'shift')});\n`;
            });
          }

          if (Array.isArray(c.shifts)) {
            c.shifts.forEach((s: any) => {
              sqlStr += `INSERT INTO system_shifts VALUES (${escapeSQLVal(s.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(s.operatorName)}, ${escapeSQLVal(s.openedAt)}, ${escapeSQLVal(s.closedAt)}, ${Number(s.totalRevenue || s.expected) || 0}, ${Number(s.expensesTotal || s.cashExpenses) || 0}, ${escapeSQLVal(s.status)});\n`;
            });
          }

          if (Array.isArray(c.inventory)) {
            c.inventory.forEach((inv: any) => {
              sqlStr += `INSERT INTO system_inventory VALUES (${escapeSQLVal(inv.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(inv.name)}, ${Number(inv.quantity) || 0}, ${Number(inv.minQuantity) || 0}, ${escapeSQLVal(inv.unit)}, ${Number(inv.price) || 0});\n`;
            });
          }

          if (Array.isArray(c.dailyClosings)) {
            c.dailyClosings.forEach((dc: any) => {
              sqlStr += `INSERT INTO system_daily_closings VALUES (${escapeSQLVal(dc.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(dc.date)}, ${Number(dc.totalIncome) || 0}, ${Number(dc.totalExpenses) || 0}, ${Number(dc.netIncome) || 0});\n`;
            });
          }

          if (Array.isArray(c.laboratories)) {
            c.laboratories.forEach((lab: any) => {
              sqlStr += `INSERT INTO system_laboratories VALUES (${escapeSQLVal(lab.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(lab.name)}, ${escapeSQLVal(lab.phone)}, ${escapeSQLVal(lab.address)});\n`;
            });
          }

          if (Array.isArray(c.labOrders)) {
            c.labOrders.forEach((lo: any) => {
              sqlStr += `INSERT INTO system_lab_orders VALUES (${escapeSQLVal(lo.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(lo.labId)}, ${escapeSQLVal(lo.labName)}, ${escapeSQLVal(lo.patientName)}, ${escapeSQLVal(lo.type || lo.orderType)}, ${Number(lo.cost) || 0}, ${Number(lo.paid) || 0}, ${escapeSQLVal(lo.status)}, ${escapeSQLVal(lo.sentDate)}, ${escapeSQLVal(lo.deliveryDate)});\n`;
            });
          }

          if (Array.isArray(info.staffMembers)) {
            info.staffMembers.forEach((st: any) => {
              const tabsStr = Array.isArray(st.allowedTabs) ? st.allowedTabs.join(',') : (st.allowedTabs || '');
              sqlStr += `INSERT INTO system_staff VALUES (${escapeSQLVal(st.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(st.name)}, ${escapeSQLVal(st.role)}, ${escapeSQLVal(st.phone)}, ${escapeSQLVal(st.email)}, ${escapeSQLVal(tabsStr)});\n`;
            });
          }
        });

        const blob = new Blob([sqlStr], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CMS_FULL_SYSTEM_BACKUP_${dateStr}.sql`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (fmt === 'zip') {
        const jsonStr = JSON.stringify(fullSystemData, null, 2);
        const innerJsonName = `CMS_FULL_SYSTEM_BACKUP_${dateStr}.json`;
        const zipBlob = await createZipBlob(innerJsonName, jsonStr);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CMS_FULL_SYSTEM_BACKUP_${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const jsonStr = JSON.stringify(fullSystemData, null, 2);
        const mimeType = fmt === 'db' ? 'application/octet-stream' : 'application/json';
        const ext = fmt === 'db' ? 'db' : 'json';
        const blob = new Blob([jsonStr], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CMS_FULL_SYSTEM_BACKUP_${dateStr}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      setBackupProgress(100);
      setBackupStatusText('تم تنزيل النسخة الاحتياطية الشاملة بنجاح!');
      if (!isAuto) {
        dialogs.alert(`تم استخراج نسخة احتياطية شاملة لكافة العيادات والسيستم بنجاح بصيغة (.${fmt})!`, { severity: 'success' });
      }
    } catch (err: any) {
      console.error('Super Admin Backup Error:', err);
      setBackupStatusText('فشل أخذ نسخة السيستم.');
      if (!isAuto) {
        dialogs.alert('حدث خطأ أثناء أخذ النسخة الاحتياطية: ' + (err.message || err.toString()), { severity: 'error' });
      }
    } finally {
      setBackupLoading(false);
    }
  };

  // Download Single Clinic Selected from Dropdown
  const handleSingleClinicExportFromDropdown = async () => {
    if (!selectedSingleClinicId) {
      dialogs.alert('يرجى اختيار العيادة المراد تنزيل نسختها أولاً.', { severity: 'warning' });
      return;
    }
    const clinic = clinics.find(c => c.id === selectedSingleClinicId);
    if (!clinic) return;

    setBackupLoading(true);
    setBackupStatusText(`جاري تنزيل نسخة عيادة: ${clinic.name}...`);
    try {
      const cId = clinic.id;
      const [
        patientsSnap,
        appointmentsSnap,
        prescriptionsSnap,
        customMedSnap,
        customCatSnap,
        shiftsSnap,
        expensesSnap,
        inventorySnap,
        billingSnap,
        closingsSnap,
        labsSnap,
        labOrdersSnap,
        labWorkTypesSnap
      ] = await Promise.all([
        getDocs(collection(db, 'clinics', cId, 'patients')),
        getDocs(collection(db, 'clinics', cId, 'appointments')),
        getDocs(collection(db, 'clinics', cId, 'prescriptions')),
        getDocs(collection(db, 'clinics', cId, 'custom_medications')),
        getDocs(collection(db, 'clinics', cId, 'custom_categories')),
        getDocs(collection(db, 'clinics', cId, 'shifts')),
        getDocs(collection(db, 'clinics', cId, 'expenses')),
        getDocs(collection(db, 'clinics', cId, 'inventory')),
        getDocs(collection(db, 'clinics', cId, 'billing')),
        getDocs(collection(db, 'clinics', cId, 'closings')),
        getDocs(collection(db, 'clinics', cId, 'laboratories')),
        getDocs(collection(db, 'clinics', cId, 'lab_orders')),
        getDocs(collection(db, 'clinics', cId, 'lab_work_types'))
      ]);

      const patientsData = await Promise.all(
        patientsSnap.docs.map(async (pDoc) => {
          const pData = { id: pDoc.id, ...pDoc.data() } as any;
          const [recsSnap, teethSnap, xraysSnap] = await Promise.all([
            getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'records')),
            getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'teeth')),
            getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'xrays'))
          ]);
          return {
            ...pData,
            records: recsSnap.docs.map(r => ({ id: r.id, ...r.data() })),
            teeth: teethSnap.docs.map(t => ({ id: t.id, ...t.data() })),
            xrays: xraysSnap.docs.map(x => ({ id: x.id, ...x.data() }))
          };
        })
      );

      const clinicBackup = {
        platform: 'CrownDent SaaS Single Clinic Backup',
        clinicId: cId,
        clinicInfo: clinic,
        backupTimestamp: new Date().toISOString(),
        data: {
          patients: patientsData,
          appointments: appointmentsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          prescriptions: prescriptionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          customMedications: customMedSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          customCategories: customCatSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          shifts: shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          expenses: expensesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          inventory: inventorySnap.docs.map(d => ({ id: d.id, ...d.data() })),
          billing: billingSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          dailyClosings: closingsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          laboratories: labsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          labOrders: labOrdersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          labWorkTypes: labWorkTypesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        }
      };

      const dateStr = new Date().toISOString().split('T')[0];
      const safeName = (clinic.name || 'Clinic').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
      const blob = new Blob([JSON.stringify(clinicBackup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BACKUP_${safeName}_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      dialogs.alert(`تم استخراج وتنزيل النسخة الاحتياطية لعيادة "${clinic.name}" بنجاح!`, { severity: 'success' });
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء تنزيل نسخة العيادة: ' + err.toString(), { severity: 'error' });
    } finally {
      setBackupLoading(false);
    }
  };

  // Step 1: Select file and open critical confirmation modal
  const handleSelectRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingRestoreFile(file);
    setRestoreConfirmInput('');
    setRestoreError('');
    e.target.value = '';
  };

  // Step 2: Execute critical restore after typing RESTORE
  const handleExecuteConfirmedRestore = async () => {
    const trimmed = restoreConfirmInput.trim().toUpperCase();
    if (trimmed !== 'RESTORE' && trimmed !== 'استعادة') {
      setRestoreError('يرجى كتابة كلمة RESTORE أو استعادة للتأكيد بدقة.');
      return;
    }

    if (!pendingRestoreFile) return;

    setBackupLoading(true);
    setBackupStatusText('جاري فك ضغط وقراءة ملف السيستم الشامل...');
    const fileToRestore = pendingRestoreFile;
    setPendingRestoreFile(null);

    try {
      const { text: content } = await readBackupFile(fileToRestore);
      if (!content) throw new Error('الملف فارغ أو يتعذر قراءته.');

      let parsed: any = null;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = null;
      }

      if (parsed) {
        if (Array.isArray(parsed.clinics) || parsed.backupScope === 'FULL_SYSTEM_BACKUP') {
          setBackupStatusText('جاري استعادة كافة العيادات وسجلات المرضى...');
          const clinicsList = parsed.clinics || [];
          let restoredClinicsCount = 0;
          let restoredPatientsCount = 0;

          for (const item of clinicsList) {
            const info = item.clinicInfo || item;
            const cId = info.id;
            if (!cId) continue;

            await setDoc(doc(db, 'clinics', cId), info, { merge: true });
            restoredClinicsCount++;

            if (Array.isArray(item.patients)) {
              for (const p of item.patients) {
                const { records, teeth, xrays, id: pId, ...pData } = p;
                const patId = pId || Math.random().toString(36).substring(2, 11);
                await setDoc(doc(db, 'clinics', cId, 'patients', patId), pData, { merge: true });
                restoredPatientsCount++;

                if (Array.isArray(records)) {
                  for (const r of records) {
                    const { id: rId, ...rData } = r;
                    const recId = rId || Math.random().toString(36).substring(2, 11);
                    await setDoc(doc(db, 'clinics', cId, 'patients', patId, 'records', recId), rData, { merge: true });
                  }
                }

                if (Array.isArray(teeth)) {
                  for (const t of teeth) {
                    const { id: tId, ...tData } = t;
                    const toothId = tId || Math.random().toString(36).substring(2, 11);
                    await setDoc(doc(db, 'clinics', cId, 'patients', patId, 'teeth', toothId), tData, { merge: true });
                  }
                }

                if (Array.isArray(xrays)) {
                  for (const x of xrays) {
                    const { id: xId, ...xData } = x;
                    const xrayId = xId || Math.random().toString(36).substring(2, 11);
                    await setDoc(doc(db, 'clinics', cId, 'patients', patId, 'xrays', xrayId), xData, { merge: true });
                  }
                }
              }
            }

            if (Array.isArray(item.appointments)) {
              for (const app of item.appointments) {
                const { id, ...appData } = app;
                if (id) await setDoc(doc(db, 'clinics', cId, 'appointments', id), appData, { merge: true });
              }
            }

            if (Array.isArray(item.prescriptions)) {
              for (const rx of item.prescriptions) {
                const { id, ...rxData } = rx;
                if (id) await setDoc(doc(db, 'clinics', cId, 'prescriptions', id), rxData, { merge: true });
              }
            }

            if (Array.isArray(item.billing)) {
              for (const bill of item.billing) {
                const { id, ...billData } = bill;
                if (id) await setDoc(doc(db, 'clinics', cId, 'billing', id), billData, { merge: true });
              }
            }

            const cMedList = item.customMedications || item.custom_medications;
            if (Array.isArray(cMedList)) {
              for (const med of cMedList) {
                const { id, ...medData } = med;
                if (id) await setDoc(doc(db, 'clinics', cId, 'custom_medications', id), medData, { merge: true });
              }
            }

            const cCatList = item.customCategories || item.custom_categories;
            if (Array.isArray(cCatList)) {
              for (const cat of cCatList) {
                const { id, ...catData } = cat;
                if (id) await setDoc(doc(db, 'clinics', cId, 'custom_categories', id), catData, { merge: true });
              }
            }

            if (Array.isArray(item.shifts)) {
              for (const s of item.shifts) { const { id, ...sData } = s; if (id) await setDoc(doc(db, 'clinics', cId, 'shifts', id), sData, { merge: true }); }
            }

            const expList = item.expenses || item.expenseList;
            if (Array.isArray(expList)) {
              for (const exp of expList) {
                const { id, ...expData } = exp;
                if (id) await setDoc(doc(db, 'clinics', cId, 'expenses', id), expData, { merge: true });
              }
            }

            if (Array.isArray(item.inventory)) {
              for (const inv of item.inventory) { const { id, ...invData } = inv; if (id) await setDoc(doc(db, 'clinics', cId, 'inventory', id), invData, { merge: true }); }
            }

            const closingsList = item.dailyClosings || item.closings;
            if (Array.isArray(closingsList)) {
              for (const dc of closingsList) { const { id, ...dcData } = dc; if (id) await setDoc(doc(db, 'clinics', cId, 'closings', id), dcData, { merge: true }); }
            }

            if (Array.isArray(item.laboratories)) {
              for (const lab of item.laboratories) { const { id, ...labData } = lab; if (id) await setDoc(doc(db, 'clinics', cId, 'laboratories', id), labData, { merge: true }); }
            }

            const labOrdersList = item.labOrders || item.lab_orders;
            if (Array.isArray(labOrdersList)) {
              for (const lo of labOrdersList) { const { id, ...loData } = lo; if (id) await setDoc(doc(db, 'clinics', cId, 'lab_orders', id), loData, { merge: true }); }
            }

            const lwtList = item.labWorkTypes || item.lab_work_types;
            if (Array.isArray(lwtList)) {
              for (const wt of lwtList) { const { id, ...wtData } = wt; if (id) await setDoc(doc(db, 'clinics', cId, 'lab_work_types', id), wtData, { merge: true }); }
            }
          }

          if (Array.isArray(parsed.renewalsLog)) {
            for (const ren of parsed.renewalsLog) {
              const { id, ...renData } = ren;
              if (id) await setDoc(doc(db, 'renewals', id), renData, { merge: true });
            }
          }

          if (Array.isArray(parsed.broadcasts)) {
            for (const bc of parsed.broadcasts) {
              const { id, ...bcData } = bc;
              if (id) await setDoc(doc(db, 'broadcasts', id), bcData, { merge: true });
            }
          }

          if (Array.isArray(parsed.systemSettings)) {
            for (const ss of parsed.systemSettings) {
              const { id, ...ssData } = ss;
              if (id) await setDoc(doc(db, 'system_settings', id), ssData, { merge: true });
            }
          }

          dialogs.alert(
            `تمت استعادة النسخة الاحتياطية الشاملة للسيستم بنجاح! تم استرجاع وتحديث (${restoredClinicsCount}) عيادة و(${restoredPatientsCount}) مريض بكافة المصروفات، الفواتير، المعامل، والبيانات المالية.`,
            { severity: 'success' }
          );
          onRefreshClinics();
          return;
        } else if (parsed.clinicId || parsed.clinicInfo || parsed.data) {
          // Single clinic restore
          const cInfo = parsed.clinicInfo || {};
          const cId = parsed.clinicId || cInfo.id || 'Restored_Clinic_' + Date.now();
          const backupData = parsed.data || parsed;

          if (cInfo.name || cInfo.id) {
            await setDoc(doc(db, 'clinics', cId), cInfo, { merge: true });
          }

          let restoredPatients = 0;
          let restoredRecords = 0;
          if (Array.isArray(backupData.patients)) {
            for (const p of backupData.patients) {
              const { records, teeth, xrays, id: pId, ...pData } = p;
              const patId = pId || Math.random().toString(36).substring(2, 11);
              await setDoc(doc(db, 'clinics', cId, 'patients', patId), pData, { merge: true });
              restoredPatients++;

              if (Array.isArray(records)) {
                for (const r of records) {
                  const { id: rId, ...rData } = r;
                  const recId = rId || Math.random().toString(36).substring(2, 11);
                  await setDoc(doc(db, 'clinics', cId, 'patients', patId, 'records', recId), rData, { merge: true });
                  restoredRecords++;
                }
              }

              if (Array.isArray(teeth)) {
                for (const t of teeth) {
                  const { id: tId, ...tData } = t;
                  const toothId = tId || Math.random().toString(36).substring(2, 11);
                  await setDoc(doc(db, 'clinics', cId, 'patients', patId, 'teeth', toothId), tData, { merge: true });
                }
              }

              if (Array.isArray(xrays)) {
                for (const x of xrays) {
                  const { id: xId, ...xData } = x;
                  const xrayId = xId || Math.random().toString(36).substring(2, 11);
                  await setDoc(doc(db, 'clinics', cId, 'patients', patId, 'xrays', xrayId), xData, { merge: true });
                }
              }
            }
          }

          if (Array.isArray(backupData.appointments)) {
            for (const app of backupData.appointments) {
              const { id, ...appData } = app;
              if (id) await setDoc(doc(db, 'clinics', cId, 'appointments', id), appData, { merge: true });
            }
          }

          if (Array.isArray(backupData.prescriptions)) {
            for (const rx of backupData.prescriptions) {
              const { id, ...rxData } = rx;
              if (id) await setDoc(doc(db, 'clinics', cId, 'prescriptions', id), rxData, { merge: true });
            }
          }

          const scCustomMeds = backupData.custom_medications || backupData.customMedications;
          if (Array.isArray(scCustomMeds)) {
            for (const med of scCustomMeds) {
              const { id, ...medData } = med;
              if (id) await setDoc(doc(db, 'clinics', cId, 'custom_medications', id), medData, { merge: true });
            }
          }

          const scCustomCats = backupData.custom_categories || backupData.customCategories;
          if (Array.isArray(scCustomCats)) {
            for (const cat of scCustomCats) {
              const { id, ...catData } = cat;
              if (id) await setDoc(doc(db, 'clinics', cId, 'custom_categories', id), catData, { merge: true });
            }
          }

          if (Array.isArray(backupData.shifts)) {
            for (const s of backupData.shifts) {
              const { id, ...sData } = s;
              if (id) await setDoc(doc(db, 'clinics', cId, 'shifts', id), sData, { merge: true });
            }
          }

          let restoredExpenses = 0;
          const scExpenses = backupData.expenses || backupData.expenseList;
          if (Array.isArray(scExpenses)) {
            for (const exp of scExpenses) {
              const { id, ...expData } = exp;
              if (id) {
                await setDoc(doc(db, 'clinics', cId, 'expenses', id), expData, { merge: true });
                restoredExpenses++;
              }
            }
          }

          if (Array.isArray(backupData.inventory)) {
            for (const inv of backupData.inventory) {
              const { id, ...invData } = inv;
              if (id) await setDoc(doc(db, 'clinics', cId, 'inventory', id), invData, { merge: true });
            }
          }

          if (Array.isArray(backupData.billing)) {
            for (const inv of backupData.billing) {
              const { id, ...invData } = inv;
              if (id) await setDoc(doc(db, 'clinics', cId, 'billing', id), invData, { merge: true });
            }
          }

          const scClosings = backupData.closings || backupData.dailyClosings;
          if (Array.isArray(scClosings)) {
            for (const closing of scClosings) {
              const { id, ...closingData } = closing;
              if (id) await setDoc(doc(db, 'clinics', cId, 'closings', id), closingData, { merge: true });
            }
          }

          if (Array.isArray(backupData.laboratories)) {
            for (const lab of backupData.laboratories) {
              const { id, ...labData } = lab;
              if (id) await setDoc(doc(db, 'clinics', cId, 'laboratories', id), labData, { merge: true });
            }
          }

          const scLabOrders = backupData.lab_orders || backupData.labOrders;
          if (Array.isArray(scLabOrders)) {
            for (const order of scLabOrders) {
              const { id, ...orderData } = order;
              if (id) await setDoc(doc(db, 'clinics', cId, 'lab_orders', id), orderData, { merge: true });
            }
          }

          const scLabWorkTypes = backupData.lab_work_types || backupData.labWorkTypes;
          if (Array.isArray(scLabWorkTypes)) {
            for (const wt of scLabWorkTypes) {
              const { id, ...wtData } = wt;
              if (id) await setDoc(doc(db, 'clinics', cId, 'lab_work_types', id), wtData, { merge: true });
            }
          }

          dialogs.alert(`تمت استعادة ملف العيادة بالكامل بنجاح! تم استرجاع (${restoredPatients}) مريض، (${restoredRecords}) جلسة علاجية، و(${restoredExpenses}) بند مصروفات مع كافة الفواتير والمواعيد.`, { severity: 'success' });
          onRefreshClinics();
          return;
        }
      }

      throw new Error('صيغة الملف غير متوافقة أو الملف تالف.');
    } catch (err: any) {
      console.error('Restore Error:', err);
      dialogs.alert('حدث خطأ أثناء استعادة البيانات: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setBackupLoading(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Database className="h-6 w-6 text-cyan-600" />
            النسخ الاحتياطي والاستعادة الشاملة (System Backup & Restore)
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            أخذ نسخ احتياطية شاملة لكافة العيادات، أو تنزيل نسخة مخصصة لعيادة بعينها، واسترجاع البيانات بأمان
          </p>
        </div>
      </div>

      {/* Progress & Status Banner */}
      {backupLoading && (
        <div className="bg-cyan-50 p-4 rounded-2xl border border-cyan-200 space-y-2 animate-pulse">
          <div className="flex items-center justify-between text-xs font-bold text-cyan-900">
            <span>{backupStatusText}</span>
            <span>{backupProgress}%</span>
          </div>
          <div className="w-full bg-cyan-200 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-cyan-600 h-full transition-all duration-300 rounded-full"
              style={{ width: `${backupProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ================= SECTION 1: FULL SYSTEM EXPORT ================= */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-cyan-50 text-cyan-600 font-bold flex items-center justify-center border border-cyan-100">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">تصدير نسخة شاملة لكافة العيادات والسيستم</h3>
                <p className="text-xs text-slate-500">حفظ جميع العيادات ({clinics.length}) وسجلات المرضى والماليات والمخازن</p>
              </div>
            </div>

            {/* Format Selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">صيغة ملف النسخة الاحتياطية:</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setExportFormat('zip')}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 relative ${
                    exportFormat === 'zip'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-950 shadow-sm ring-1 ring-emerald-400'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <FileArchive className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="font-mono text-sm">ZIP (.zip)</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-100/80 px-1.5 py-0.5 rounded">مضغوط 85% للأحجام الكبيرة</span>
                </button>

                <button
                  type="button"
                  onClick={() => setExportFormat('json')}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 ${
                    exportFormat === 'json'
                      ? 'border-cyan-500 bg-cyan-50 text-cyan-900 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="font-mono text-sm">JSON (.json)</span>
                  <span className="text-[10px] text-slate-400">ملف قياسي مباشر</span>
                </button>

                <button
                  type="button"
                  onClick={() => setExportFormat('sql')}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 ${
                    exportFormat === 'sql'
                      ? 'border-cyan-500 bg-cyan-50 text-cyan-900 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="font-mono text-sm">SQL Dump (.sql)</span>
                  <span className="text-[10px] text-slate-400">لقواعد البيانات والخوادم</span>
                </button>

                <button
                  type="button"
                  onClick={() => setExportFormat('db')}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 ${
                    exportFormat === 'db'
                      ? 'border-cyan-500 bg-cyan-50 text-cyan-900 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="font-mono text-sm">DB Archive (.db)</span>
                  <span className="text-[10px] text-slate-400">أرشيف قاعدة بيانات</span>
                </button>
              </div>
            </div>
          </div>

          <button
            id="btn-download-full-system-backup"
            disabled={backupLoading}
            onClick={() => handleFullSystemBackup()}
            className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 active:bg-cyan-800 text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 text-xs"
          >
            <Download className="h-4 w-4" />
            تنزيل نسخة احتياطية فورية شاملة للمنظومة بالكامل
          </button>
        </div>

        {/* ================= SECTION 2: SINGLE CLINIC EXPORT ================= */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center border border-indigo-100">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">تصدير نسخة مخصصة لعيادة منفردة</h3>
                <p className="text-xs text-slate-500">تنزيل نسخة خاصة ببيانات عيادة معينة فقط بشكل فوري</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">اختر العيادة المطلوبة:</label>
              <select
                value={selectedSingleClinicId}
                onChange={(e) => setSelectedSingleClinicId(e.target.value)}
                className="w-full p-3 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              >
                <option value="">-- اختر عيادة من القائمة --</option>
                {clinics.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} - (د. {c.doctorName || 'غير محدد'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            disabled={backupLoading || !selectedSingleClinicId}
            onClick={handleSingleClinicExportFromDropdown}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 text-xs"
          >
            <Download className="h-4 w-4" />
            تنزيل نسخة العيادة المختارة ({exportFormat === 'zip' ? '.zip' : '.json'})
          </button>
        </div>

        {/* ================= SECTION 3: AUTOMATED DAILY BACKUP ================= */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 font-bold flex items-center justify-center border border-amber-100">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">النسخ الاحتياطي اليومي التلقائي</h3>
                <p className="text-xs text-slate-500">حفظ نسخة تلقائية يومياً في منتصف الليل (12:00 AM)</p>
              </div>
            </div>

            {/* Toggle switch */}
            <button
              onClick={() => handleSaveAutoBackupSettings(!autoBackupEnabled, autoBackupFormat)}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition cursor-pointer ${
                autoBackupEnabled ? 'bg-emerald-500 justify-end' : 'bg-slate-300 justify-start'
              }`}
            >
              <div className="bg-white w-4 h-4 rounded-full shadow-md" />
            </button>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3 text-xs text-slate-600">
            <div className="flex items-center justify-between">
              <span>صيغة النسخ التلقائي:</span>
              <div className="flex items-center gap-1.5">
                {(['zip', 'json', 'sql', 'db'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => handleSaveAutoBackupSettings(autoBackupEnabled, fmt, true)}
                    className={`px-2 py-1 rounded-md text-[11px] font-mono font-bold uppercase transition ${
                      autoBackupFormat === fmt
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span>حالة النسخ التلقائي:</span>
              <span className={`font-bold ${autoBackupEnabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                {autoBackupEnabled ? `مفعل ويعمل يومياً بصيغة (.${autoBackupFormat})` : 'معطل'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>آخر عملية نسخ تلقائي تمت:</span>
              <span className="font-mono text-slate-800 font-bold">{lastAutoBackupDate}</span>
            </div>
          </div>
        </div>

        {/* ================= SECTION 4: FULL SYSTEM RESTORE ================= */}
        <div className="bg-white p-6 rounded-2xl border border-rose-200 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 font-bold flex items-center justify-center border border-rose-100">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-rose-900">استعادة بيانات المنظومة والعيادات</h3>
              <p className="text-xs text-slate-500">رفع ملف نسخة احتياطية سابقة لاسترجاع أو دمج البيانات</p>
            </div>
          </div>

          <div className="bg-rose-50/50 p-3.5 rounded-xl border border-rose-100 text-xs text-rose-800 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
              حماية أمنية مشددة:
            </div>
            <p className="text-[11px] text-rose-700 leading-relaxed">
              يدعم الملفات المضغوطة (.zip) و (.json / .db / .sql) مع تأكيد كتابي لحماية سلامة البيانات.
            </p>
          </div>

          <label className="w-full py-3 bg-white border-2 border-dashed border-rose-300 hover:border-rose-500 text-rose-700 font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-2 text-xs">
            <Upload className="h-4 w-4" />
            اختيار ملف الاستعادة (.zip / .json / .db / .sql)
            <input
              type="file"
              accept=".zip,.json,.db,.sql"
              className="hidden"
              onChange={handleSelectRestoreFile}
            />
          </label>
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
                <h3 className="text-lg font-extrabold text-rose-900">تأكيد أمان حرج: استعادة بيانات السيستم</h3>
                <p className="text-xs text-slate-500">الملف المحدد: {pendingRestoreFile.name}</p>
              </div>
            </div>

            <div className="p-4 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-900 space-y-2 leading-relaxed">
              <p className="font-bold">
                ⚠️ تنبيه فائق الأهمية:
              </p>
              <p>
                ستقوم هذه العملية بالكتابة فوق وتحديث بيانات العيادات، المرضى، المواعيد، والماليات من هذا الملف.
              </p>
              <p className="font-semibold text-rose-800">
                للمتابعة، يرجى كتابة كلمة <span className="font-mono bg-rose-200 px-1.5 py-0.5 rounded text-rose-950 font-bold">RESTORE</span> في الحقل أدناه:
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
                onChange={(e) => {
                  setRestoreConfirmInput(e.target.value);
                  setRestoreError('');
                }}
                placeholder="اكتب RESTORE للتأكيد"
                className="w-full p-3 border-2 border-rose-300 rounded-xl text-center font-mono font-bold text-sm tracking-widest text-slate-900 focus:border-rose-600 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingRestoreFile(null)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition text-xs cursor-pointer"
              >
                إلغاء العملية
              </button>
              <button
                type="button"
                disabled={backupLoading}
                onClick={handleExecuteConfirmedRestore}
                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-xl shadow-md transition text-xs cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {backupLoading ? 'جاري الاستعادة...' : 'تأكيد واستعادة البيانات الآن'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
