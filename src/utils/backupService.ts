import { db, getDocsSmart as getDocs, collection } from '../dbClient';
import { safeStorage } from './storage';
import JSZip from 'jszip';

export function getLocalTodayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function createZipBlob(innerFilename: string, textContent: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file(innerFilename, textContent, { compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

export async function readBackupFile(file: File): Promise<{ text: string; filename: string }> {
  if (file.name.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file);
    const candidate = Object.values(zip.files).find(
      (f) => !f.dir && (f.name.endsWith('.json') || f.name.endsWith('.db') || f.name.endsWith('.sql') || f.name.endsWith('.txt'))
    );
    if (!candidate) {
      throw new Error('لم يتم العثور على ملف بيانات صالح داخل الأرشيف المضغوط (ZIP).');
    }
    const text = await candidate.async('string');
    return { text, filename: candidate.name };
  } else {
    const text = await file.text();
    return { text, filename: file.name };
  }
}

export async function exportClinicBackup(
  clinicId: string,
  clinicObj: any,
  targetFormat: 'zip' | 'json' | 'db' | 'sql' = 'zip',
  isAuto: boolean = false
): Promise<{ success: boolean; filename: string; patientCount: number; message: string }> {
  if (!clinicId) {
    throw new Error('رقم العيادة غير معرف لأخذ النسخة الاحتياطية.');
  }

  const cleanName = (clinicObj?.nameEn || clinicObj?.name || clinicObj?.nameAr || 'Clinic')
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_');
  const dateStr = getLocalTodayStr();

  // 1. Fetch Patients & Sub-records for THIS clinic ONLY
  const patientsSnap = await getDocs(collection(db, 'clinics', clinicId, 'patients'));
  const patientsData = await Promise.all(
    patientsSnap.docs.map(async (docSnap) => {
      const patientId = docSnap.id;
      const pData = { id: patientId, ...docSnap.data() } as any;

      try {
        const recordsSnap = await getDocs(collection(db, 'clinics', clinicId, 'patients', patientId, 'records'));
        pData.records = recordsSnap.docs.map((r) => ({ id: r.id, ...r.data() }));
      } catch (e) {
        pData.records = pData.records || [];
      }

      try {
        const teethSnap = await getDocs(collection(db, 'clinics', clinicId, 'patients', patientId, 'teeth'));
        pData.teeth = teethSnap.docs.map((t) => ({ id: t.id, ...t.data() }));
      } catch (e) {
        pData.teeth = pData.teeth || [];
      }

      try {
        const xraysSnap = await getDocs(collection(db, 'clinics', clinicId, 'patients', patientId, 'xrays'));
        pData.xrays = xraysSnap.docs.map((x) => ({ id: x.id, ...x.data() }));
      } catch (e) {
        pData.xrays = pData.xrays || [];
      }

      return pData;
    })
  );

  // 2. Fetch Appointments for THIS clinic ONLY
  const appointmentsSnap = await getDocs(collection(db, 'clinics', clinicId, 'appointments'));
  const appointmentsData = appointmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  // 3. Fetch Prescriptions for THIS clinic ONLY
  const prescriptionsSnap = await getDocs(collection(db, 'clinics', clinicId, 'prescriptions'));
  const prescriptionsData = prescriptionsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  // 4. Fetch custom medications, categories & shifts for THIS clinic ONLY
  const customMedSnap = await getDocs(collection(db, 'clinics', clinicId, 'custom_medications'));
  const customMedData = customMedSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const customCatSnap = await getDocs(collection(db, 'clinics', clinicId, 'custom_categories'));
  const customCatData = customCatSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const shiftsSnap = await getDocs(collection(db, 'clinics', clinicId, 'shifts'));
  const shiftsData = shiftsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  // 5. Fetch additional platform data for THIS clinic ONLY
  const expensesSnap = await getDocs(collection(db, 'clinics', clinicId, 'expenses'));
  const expensesData = expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const inventorySnap = await getDocs(collection(db, 'clinics', clinicId, 'inventory'));
  const inventoryData = inventorySnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const billingSnap = await getDocs(collection(db, 'clinics', clinicId, 'billing'));
  const billingData = billingSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const closingsSnap = await getDocs(collection(db, 'clinics', clinicId, 'closings'));
  const closingsData = closingsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const laboratoriesSnap = await getDocs(collection(db, 'clinics', clinicId, 'laboratories'));
  const laboratoriesData = laboratoriesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const labOrdersSnap = await getDocs(collection(db, 'clinics', clinicId, 'lab_orders'));
  const labOrdersData = labOrdersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const labWorkTypesSnap = await getDocs(collection(db, 'clinics', clinicId, 'lab_work_types'));
  const labWorkTypesData = labWorkTypesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  let filename = '';
  let mime = 'application/json';

  // TYPE 1: ANSI SQL File (.sql)
  if (targetFormat === 'sql') {
    const escapeSQLVal = (val: any): string => {
      if (val === undefined || val === null) return 'NULL';
      if (typeof val === 'number') return val.toString();
      const clean = val.toString().replace(/'/g, "''");
      return `'${clean}'`;
    };

    let sqlContent = `-- CMS Clinic Isolated SQL Backup Dump\n`;
    sqlContent += `-- Generated: ${new Date().toISOString()}\n`;
    sqlContent += `-- Clinic Name: ${clinicObj?.name || clinicObj?.nameAr || 'Clinic'}\n`;
    sqlContent += `-- Clinic ID: ${clinicId}\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS patients (\n`;
    sqlContent += `  patient_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  name VARCHAR(255) NOT NULL,\n`;
    sqlContent += `  phone VARCHAR(50),\n`;
    sqlContent += `  age VARCHAR(50),\n`;
    sqlContent += `  medical_history TEXT,\n`;
    sqlContent += `  created_at VARCHAR(100)\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS medical_sessions (\n`;
    sqlContent += `  session_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  patient_id VARCHAR(100),\n`;
    sqlContent += `  patient_name VARCHAR(255),\n`;
    sqlContent += `  tooth_number VARCHAR(100),\n`;
    sqlContent += `  procedure_name VARCHAR(255),\n`;
    sqlContent += `  cost DECIMAL(10,2),\n`;
    sqlContent += `  paid DECIMAL(10,2),\n`;
    sqlContent += `  remaining DECIMAL(10,2),\n`;
    sqlContent += `  session_date VARCHAR(50),\n`;
    sqlContent += `  notes TEXT\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS appointments (\n`;
    sqlContent += `  appointment_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  patient_id VARCHAR(100),\n`;
    sqlContent += `  patient_name VARCHAR(255),\n`;
    sqlContent += `  patient_phone VARCHAR(50),\n`;
    sqlContent += `  appointment_date VARCHAR(50),\n`;
    sqlContent += `  appointment_time VARCHAR(50),\n`;
    sqlContent += `  treatment_type VARCHAR(255),\n`;
    sqlContent += `  status VARCHAR(50),\n`;
    sqlContent += `  expected_cost DECIMAL(10,2)\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS prescriptions (\n`;
    sqlContent += `  prescription_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  patient_id VARCHAR(100),\n`;
    sqlContent += `  patient_name VARCHAR(255),\n`;
    sqlContent += `  prescription_date VARCHAR(50),\n`;
    sqlContent += `  medications TEXT,\n`;
    sqlContent += `  notes TEXT\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS expenses (\n`;
    sqlContent += `  expense_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  title VARCHAR(255),\n`;
    sqlContent += `  amount DECIMAL(10,2),\n`;
    sqlContent += `  category VARCHAR(100),\n`;
    sqlContent += `  payment_method VARCHAR(100),\n`;
    sqlContent += `  expense_date VARCHAR(50),\n`;
    sqlContent += `  type VARCHAR(50),\n`;
    sqlContent += `  notes TEXT\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS shifts (\n`;
    sqlContent += `  shift_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  operator_name VARCHAR(255),\n`;
    sqlContent += `  opened_at VARCHAR(100),\n`;
    sqlContent += `  closed_at VARCHAR(100),\n`;
    sqlContent += `  total_revenue DECIMAL(10,2),\n`;
    sqlContent += `  expenses_total DECIMAL(10,2),\n`;
    sqlContent += `  status VARCHAR(50)\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS inventory (\n`;
    sqlContent += `  item_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  name VARCHAR(255),\n`;
    sqlContent += `  quantity DECIMAL(10,2),\n`;
    sqlContent += `  min_quantity DECIMAL(10,2),\n`;
    sqlContent += `  unit VARCHAR(50),\n`;
    sqlContent += `  price DECIMAL(10,2)\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS billing (\n`;
    sqlContent += `  billing_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  patient_id VARCHAR(100),\n`;
    sqlContent += `  patient_name VARCHAR(255),\n`;
    sqlContent += `  total_amount DECIMAL(10,2),\n`;
    sqlContent += `  paid_amount DECIMAL(10,2),\n`;
    sqlContent += `  remaining_amount DECIMAL(10,2),\n`;
    sqlContent += `  invoice_date VARCHAR(50)\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS daily_closings (\n`;
    sqlContent += `  closing_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  closing_date VARCHAR(50),\n`;
    sqlContent += `  total_income DECIMAL(10,2),\n`;
    sqlContent += `  total_expenses DECIMAL(10,2),\n`;
    sqlContent += `  net_income DECIMAL(10,2)\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS laboratories (\n`;
    sqlContent += `  lab_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  name VARCHAR(255),\n`;
    sqlContent += `  phone VARCHAR(50),\n`;
    sqlContent += `  address TEXT\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS lab_orders (\n`;
    sqlContent += `  order_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  lab_id VARCHAR(100),\n`;
    sqlContent += `  lab_name VARCHAR(255),\n`;
    sqlContent += `  patient_name VARCHAR(255),\n`;
    sqlContent += `  order_type VARCHAR(255),\n`;
    sqlContent += `  cost DECIMAL(10,2),\n`;
    sqlContent += `  paid DECIMAL(10,2),\n`;
    sqlContent += `  status VARCHAR(50),\n`;
    sqlContent += `  sent_date VARCHAR(50),\n`;
    sqlContent += `  delivery_date VARCHAR(50)\n`;
    sqlContent += `);\n\n`;

    sqlContent += `CREATE TABLE IF NOT EXISTS staff_members (\n`;
    sqlContent += `  staff_id VARCHAR(100) PRIMARY KEY,\n`;
    sqlContent += `  name VARCHAR(255),\n`;
    sqlContent += `  role VARCHAR(100),\n`;
    sqlContent += `  phone VARCHAR(50),\n`;
    sqlContent += `  email VARCHAR(100),\n`;
    sqlContent += `  allowed_tabs TEXT\n`;
    sqlContent += `);\n\n`;

    sqlContent += `-- Data Insertion for Clinic: ${clinicObj?.name || clinicId} --\n\n`;

    sqlContent += `-- Inserting Patients Data (${patientsData.length})\n`;
    patientsData.forEach((p) => {
      sqlContent += `INSERT INTO patients (patient_id, name, phone, age, medical_history, created_at) VALUES (${escapeSQLVal(p.id)}, ${escapeSQLVal(p.name)}, ${escapeSQLVal(p.phone)}, ${escapeSQLVal(p.age)}, ${escapeSQLVal(p.medicalHistory)}, ${escapeSQLVal(p.createdAt || '')});\n`;
    });

    sqlContent += `\n-- Inserting Medical Sessions Data\n`;
    patientsData.forEach((p) => {
      if (p.records && p.records.length > 0) {
        p.records.forEach((r: any) => {
          const costVal = Number(r.cost) || 0;
          const paidVal = Number(r.paid) || 0;
          sqlContent += `INSERT INTO medical_sessions (session_id, patient_id, patient_name, tooth_number, procedure_name, cost, paid, remaining, session_date, notes) VALUES (${escapeSQLVal(r.id)}, ${escapeSQLVal(p.id)}, ${escapeSQLVal(p.name)}, ${escapeSQLVal(r.toothNumber)}, ${escapeSQLVal(r.procedure)}, ${costVal}, ${paidVal}, ${costVal - paidVal}, ${escapeSQLVal(r.date)}, ${escapeSQLVal(r.notes)});\n`;
        });
      }
    });

    sqlContent += `\n-- Inserting Appointments Data (${appointmentsData.length})\n`;
    appointmentsData.forEach((app) => {
      sqlContent += `INSERT INTO appointments (appointment_id, patient_id, patient_name, patient_phone, appointment_date, appointment_time, treatment_type, status, expected_cost) VALUES (${escapeSQLVal(app.id)}, ${escapeSQLVal(app.patientId || '')}, ${escapeSQLVal(app.patientName)}, ${escapeSQLVal(app.patientPhone)}, ${escapeSQLVal(app.date)}, ${escapeSQLVal(app.time)}, ${escapeSQLVal(app.treatmentType)}, ${escapeSQLVal(app.status)}, ${Number(app.expectedCost) || 0});\n`;
    });

    sqlContent += `\n-- Inserting Prescriptions Data (${prescriptionsData.length})\n`;
    prescriptionsData.forEach((pres) => {
      const medsStr = Array.isArray(pres.medications)
        ? pres.medications.map((m: any) => `${m.name} (${m.dosage})`).join(' | ')
        : pres.medicationsText || '';
      sqlContent += `INSERT INTO prescriptions (prescription_id, patient_id, patient_name, prescription_date, medications, notes) VALUES (${escapeSQLVal(pres.id)}, ${escapeSQLVal(pres.patientId || '')}, ${escapeSQLVal(pres.patientName || '')}, ${escapeSQLVal(pres.date)}, ${escapeSQLVal(medsStr)}, ${escapeSQLVal(pres.notes)});\n`;
    });

    sqlContent += `\n-- Inserting Expenses Data (${expensesData.length})\n`;
    expensesData.forEach((exp) => {
      sqlContent += `INSERT INTO expenses (expense_id, title, amount, category, payment_method, expense_date, type, notes) VALUES (${escapeSQLVal(exp.id)}, ${escapeSQLVal(exp.title)}, ${Number(exp.amount) || 0}, ${escapeSQLVal(exp.category)}, ${escapeSQLVal(exp.paymentMethod || 'كاش')}, ${escapeSQLVal(exp.date)}, ${escapeSQLVal(exp.type || 'shift')}, ${escapeSQLVal(exp.notes)});\n`;
    });

    sqlContent += `\n-- Inserting Shifts Data (${shiftsData.length})\n`;
    shiftsData.forEach((s) => {
      sqlContent += `INSERT INTO shifts (shift_id, operator_name, opened_at, closed_at, total_revenue, expenses_total, status) VALUES (${escapeSQLVal(s.id)}, ${escapeSQLVal(s.operatorName)}, ${escapeSQLVal(s.openedAt)}, ${escapeSQLVal(s.closedAt)}, ${Number(s.totalRevenue || s.expected) || 0}, ${Number(s.expensesTotal || s.cashExpenses) || 0}, ${escapeSQLVal(s.status)});\n`;
    });

    sqlContent += `\n-- Inserting Inventory Data (${inventoryData.length})\n`;
    inventoryData.forEach((inv) => {
      sqlContent += `INSERT INTO inventory (item_id, name, quantity, min_quantity, unit, price) VALUES (${escapeSQLVal(inv.id)}, ${escapeSQLVal(inv.name)}, ${Number(inv.quantity) || 0}, ${Number(inv.minQuantity) || 0}, ${escapeSQLVal(inv.unit)}, ${Number(inv.price) || 0});\n`;
    });

    sqlContent += `\n-- Inserting Billing Data (${billingData.length})\n`;
    billingData.forEach((b) => {
      sqlContent += `INSERT INTO billing (billing_id, patient_id, patient_name, total_amount, paid_amount, remaining_amount, invoice_date) VALUES (${escapeSQLVal(b.id)}, ${escapeSQLVal(b.patientId)}, ${escapeSQLVal(b.patientName)}, ${Number(b.totalAmount) || 0}, ${Number(b.paidAmount) || 0}, ${Number(b.remainingAmount) || 0}, ${escapeSQLVal(b.date)});\n`;
    });

    sqlContent += `\n-- Inserting Laboratories Data (${laboratoriesData.length})\n`;
    laboratoriesData.forEach((lab) => {
      sqlContent += `INSERT INTO laboratories (lab_id, name, phone, address) VALUES (${escapeSQLVal(lab.id)}, ${escapeSQLVal(lab.name)}, ${escapeSQLVal(lab.phone)}, ${escapeSQLVal(lab.address)});\n`;
    });

    sqlContent += `\n-- Inserting Lab Orders Data (${labOrdersData.length})\n`;
    labOrdersData.forEach((lo) => {
      sqlContent += `INSERT INTO lab_orders (order_id, lab_id, lab_name, patient_name, order_type, cost, paid, status, sent_date, delivery_date) VALUES (${escapeSQLVal(lo.id)}, ${escapeSQLVal(lo.labId)}, ${escapeSQLVal(lo.labName)}, ${escapeSQLVal(lo.patientName)}, ${escapeSQLVal(lo.type || lo.orderType)}, ${Number(lo.cost) || 0}, ${Number(lo.paid) || 0}, ${escapeSQLVal(lo.status)}, ${escapeSQLVal(lo.sentDate)}, ${escapeSQLVal(lo.deliveryDate)});\n`;
    });

    if (clinicObj && Array.isArray(clinicObj.staffMembers)) {
      sqlContent += `\n-- Inserting Staff Members Data (${clinicObj.staffMembers.length})\n`;
      clinicObj.staffMembers.forEach((st: any) => {
        const tabsStr = Array.isArray(st.allowedTabs) ? st.allowedTabs.join(',') : (st.allowedTabs || '');
        sqlContent += `INSERT INTO staff_members (staff_id, name, role, phone, email, allowed_tabs) VALUES (${escapeSQLVal(st.id)}, ${escapeSQLVal(st.name)}, ${escapeSQLVal(st.role)}, ${escapeSQLVal(st.phone)}, ${escapeSQLVal(st.email)}, ${escapeSQLVal(tabsStr)});\n`;
      });
    }

    filename = `CMS_ClinicBackup_${cleanName}_${dateStr}.sql`;
    const blob = new Blob([sqlContent], { type: 'text/plain;charset=utf-8;' });
    triggerDownload(blob, filename);

    return {
      success: true,
      filename,
      patientCount: patientsData.length,
      message: `تم تنزيل النسخة الاحتياطية بصيغة SQL (.sql) للعيادة بنجاح!`,
    };
  }

  // TYPE 2, 3 & 4: ZIP Compressed (.zip), Database File (.db) or JSON (.json)
  const exportObject = {
    platform: 'Clinic SaaS System',
    fileType: 'CLINIC_DATABASE_BACKUP',
    exportTimestamp: new Date().toISOString(),
    clinicId: clinicId,
    clinicName: clinicObj?.name || clinicObj?.nameAr || clinicObj?.nameEn,
    clinicInfo: clinicObj,
    data: {
      patients: patientsData,
      appointments: appointmentsData,
      prescriptions: prescriptionsData,
      custom_medications: customMedData,
      custom_categories: customCatData,
      shifts: shiftsData,
      expenses: expensesData,
      inventory: inventoryData,
      billing: billingData,
      closings: closingsData,
      laboratories: laboratoriesData,
      lab_orders: labOrdersData,
      lab_work_types: labWorkTypesData,
    },
  };

  const jsonStr = JSON.stringify(exportObject, null, 2);

  if (targetFormat === 'zip') {
    filename = `CMS_ClinicBackup_${cleanName}_${dateStr}.zip`;
    const innerJsonName = `CMS_ClinicBackup_${cleanName}_${dateStr}.json`;
    const zipBlob = await createZipBlob(innerJsonName, jsonStr);
    triggerDownload(zipBlob, filename);

    return {
      success: true,
      filename,
      patientCount: patientsData.length,
      message: `تم تنزيل النسخة الاحتياطية المضغوطة (.zip) للعيادة بنجاح (حجم مخفض فائق السرعة)!`,
    };
  }

  const ext = targetFormat === 'json' ? 'json' : 'db';
  mime = targetFormat === 'json' ? 'application/json' : 'application/octet-stream';
  filename = `CMS_ClinicBackup_${cleanName}_${dateStr}.${ext}`;

  const blob = new Blob([jsonStr], { type: mime });
  triggerDownload(blob, filename);

  return {
    success: true,
    filename,
    patientCount: patientsData.length,
    message: `تم تنزيل النسخة الاحتياطية بصيغة (.${ext}) للعيادة بنجاح!`,
  };
}

export async function exportFullSystemBackup(
  targetFormat: 'zip' | 'json' | 'db' | 'sql' = 'zip'
): Promise<{ success: boolean; filename: string; totalClinics: number; message: string }> {
  const dateStr = getLocalTodayStr();
  const clinicsSnap = await getDocs(collection(db, 'clinics'));

  const allClinicsData = await Promise.all(
    clinicsSnap.docs.map(async (clinicDoc) => {
      const cId = clinicDoc.id;
      const cData = { id: cId, ...clinicDoc.data() } as any;

      const patientsSnap = await getDocs(collection(db, 'clinics', cId, 'patients'));
      const patientsData = await Promise.all(
        patientsSnap.docs.map(async (pDoc) => {
          const pData = { id: pDoc.id, ...pDoc.data() } as any;
          const recsSnap = await getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'records'));
          const recsData = recsSnap.docs.map((r) => ({ id: r.id, ...r.data() }));
          const teethSnap = await getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'teeth'));
          const teethData = teethSnap.docs.map((t) => ({ id: t.id, ...t.data() }));
          const xraysSnap = await getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'xrays'));
          const xraysData = xraysSnap.docs.map((x) => ({ id: x.id, ...x.data() }));
          return { ...pData, records: recsData, teeth: teethData, xrays: xraysData };
        })
      );

      const appointmentsSnap = await getDocs(collection(db, 'clinics', cId, 'appointments'));
      const prescriptionsSnap = await getDocs(collection(db, 'clinics', cId, 'prescriptions'));
      const customMedSnap = await getDocs(collection(db, 'clinics', cId, 'custom_medications'));
      const customCatSnap = await getDocs(collection(db, 'clinics', cId, 'custom_categories'));
      const shiftsSnap = await getDocs(collection(db, 'clinics', cId, 'shifts'));
      const expensesSnap = await getDocs(collection(db, 'clinics', cId, 'expenses'));
      const inventorySnap = await getDocs(collection(db, 'clinics', cId, 'inventory'));
      const billingSnap = await getDocs(collection(db, 'clinics', cId, 'billing'));
      const closingsSnap = await getDocs(collection(db, 'clinics', cId, 'closings'));
      const laboratoriesSnap = await getDocs(collection(db, 'clinics', cId, 'laboratories'));
      const labOrdersSnap = await getDocs(collection(db, 'clinics', cId, 'lab_orders'));
      const labWorkTypesSnap = await getDocs(collection(db, 'clinics', cId, 'lab_work_types'));

      return {
        clinicInfo: cData,
        patients: patientsData,
        appointments: appointmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        prescriptions: prescriptionsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        customMedications: customMedSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        customCategories: customCatSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        shifts: shiftsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        expenses: expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        inventory: inventorySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        billing: billingSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        dailyClosings: closingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        laboratories: laboratoriesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        labOrders: labOrdersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        labWorkTypes: labWorkTypesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
    })
  );

  const renewalsSnap = await getDocs(collection(db, 'renewals'));
  const renewalsData = renewalsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const broadcastsSnap = await getDocs(collection(db, 'broadcasts'));
  const broadcastsData = broadcastsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const systemSettingsSnap = await getDocs(collection(db, 'system_settings'));
  const systemSettingsData = systemSettingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const fullSystemData = {
    platform: 'CrownDent Multi-Tenant System Master',
    backupScope: 'FULL_SYSTEM_BACKUP',
    backupTimestamp: new Date().toISOString(),
    totalClinicsCount: allClinicsData.length,
    renewalsLog: renewalsData,
    broadcasts: broadcastsData,
    systemSettings: systemSettingsData,
    clinics: allClinicsData,
  };

  if (targetFormat === 'sql') {
    const filename = `CMS_FULL_SYSTEM_BACKUP_${dateStr}.sql`;
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

    allClinicsData.forEach((c) => {
      const info = c.clinicInfo;
      sqlStr += `INSERT INTO system_clinics VALUES (${escapeSQLVal(info.id)}, ${escapeSQLVal(info.name)}, ${escapeSQLVal(info.doctorName)}, ${escapeSQLVal(info.email)}, ${escapeSQLVal(info.createdAt)});\n`;

      c.patients.forEach((p: any) => {
        sqlStr += `INSERT INTO system_patients VALUES (${escapeSQLVal(p.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(p.name)}, ${escapeSQLVal(p.phone)}, ${escapeSQLVal(p.age)}, ${escapeSQLVal(p.medicalHistory)});\n`;
      });

      c.appointments.forEach((app: any) => {
        sqlStr += `INSERT INTO system_appointments VALUES (${escapeSQLVal(app.id)}, ${escapeSQLVal(info.id)}, ${escapeSQLVal(app.patientId)}, ${escapeSQLVal(app.patientName)}, ${escapeSQLVal(app.date)}, ${escapeSQLVal(app.status)}, ${Number(app.expectedCost) || 0});\n`;
      });

      c.prescriptions.forEach((pres: any) => {
        const medsStr = Array.isArray(pres.medications)
          ? pres.medications.map((m: any) => `${m.name} (${m.dosage})`).join(' | ')
          : pres.medicationsText || '';
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
    triggerDownload(blob, filename);

    return {
      success: true,
      filename,
      totalClinics: allClinicsData.length,
      message: 'تم تنزيل النسخة الاحتياطية الشاملة للسيستم بالكامل بنجاح!',
    };
  }

  const jsonStr = JSON.stringify(fullSystemData, null, 2);

  if (targetFormat === 'zip') {
    const filename = `CMS_FULL_SYSTEM_BACKUP_${dateStr}.zip`;
    const innerJsonName = `CMS_FULL_SYSTEM_BACKUP_${dateStr}.json`;
    const zipBlob = await createZipBlob(innerJsonName, jsonStr);
    triggerDownload(zipBlob, filename);

    return {
      success: true,
      filename,
      totalClinics: allClinicsData.length,
      message: 'تم تنزيل النسخة الاحتياطية الشاملة المضغوطة (.zip) للسيستم بالكامل بنجاح!',
    };
  }

  const ext = targetFormat === 'db' ? 'db' : 'json';
  const filename = `CMS_FULL_SYSTEM_BACKUP_${dateStr}.${ext}`;
  const mimeType = targetFormat === 'db' ? 'application/octet-stream' : 'application/json';
  const blob = new Blob([jsonStr], { type: mimeType });
  triggerDownload(blob, filename);

  return {
    success: true,
    filename,
    totalClinics: allClinicsData.length,
    message: 'تم تنزيل النسخة الاحتياطية الشاملة للسيستم بالكامل بنجاح!',
  };
}

function triggerDownload(blob: Blob, filename: string) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (err) {
    console.error('Trigger download failed:', err);
  }
}

export async function checkAndRunAutoBackup(
  clinicId: string,
  clinicObj?: any,
  force: boolean = false
): Promise<{ triggered: boolean; date: string; format: string; filename?: string }> {
  if (!clinicId) return { triggered: false, date: '', format: 'zip' };

  const isEnabled =
    force ||
    safeStorage.getItem(`auto_backup_enabled_${clinicId}`) === 'true' ||
    clinicObj?.autoBackupEnabled === true ||
    clinicObj?.autoBackupEnabled === undefined; // default true for peace of mind

  if (!isEnabled) {
    return { triggered: false, date: '', format: 'zip' };
  }

  const fmt =
    (safeStorage.getItem(`auto_backup_format_${clinicId}`) as 'zip' | 'json' | 'db' | 'sql') ||
    clinicObj?.autoBackupFormat ||
    'zip';
  const todayStr = getLocalTodayStr();
  const lastDate = safeStorage.getItem(`auto_backup_last_date_${clinicId}`);

  if (lastDate !== todayStr || force) {
    console.log('Automated daily backup triggered for clinic:', clinicId, 'Date:', todayStr);
    safeStorage.setItem(`auto_backup_last_date_${clinicId}`, todayStr);

    try {
      const res = await exportClinicBackup(clinicId, clinicObj, fmt, true);
      return { triggered: true, date: todayStr, format: fmt, filename: res.filename };
    } catch (err) {
      console.error('Auto backup failed:', err);
      return { triggered: false, date: todayStr, format: fmt };
    }
  }

  return { triggered: false, date: todayStr, format: fmt };
}
