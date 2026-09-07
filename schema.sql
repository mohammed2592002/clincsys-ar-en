-- =====================================================================
-- CROWNDENT SAAS - PostgreSQL Database Schema & Setup Script
-- تم إعداد هذا الملف خصيصاً للعمل بشكل مباشر على قواعد بيانات PostgreSQL
-- (متوافق تماماً مع Hostinger, Supabase, Neon, Aiven, أو أي سيرفر PostgreSQL آخر)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. إنشاء وظيفة متوافقة لاستخراج قيم الـ JSON (Custom json_extract Function)
-- لتوفير توافق كامل مع استعلامات النظام المستخرجة لبيانات الـ JSON
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION json_extract(json_text text, path text)
RETURNS text AS $$
DECLARE
  clean_path text;
  result text;
BEGIN
  -- تنظيف المسار بإزالة بادئة $.
  clean_path := replace(path, '$.', '');
  BEGIN
    result := (json_text::json)->>clean_path;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      result := (json_text::jsonb)->>clean_path;
    EXCEPTION WHEN OTHERS THEN
      result := NULL;
    END;
  END;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------
-- 2. إنشاء الجداول الأساسية للنظام (Core SaaS Tables)
-- ---------------------------------------------------------------------

-- جدول العيادات (Clinics)
CREATE TABLE IF NOT EXISTS clinics (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول المستخدمين والموظفين والأطباء (Users / Staff)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول المرضى (Patients)
CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول المواعيد (Appointments)
CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول الملفات والزيارات الطبية والتاريخ المرضي (Patient Medical Records)
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    patientId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول الروشتات الطبية (Prescriptions)
CREATE TABLE IF NOT EXISTS prescriptions (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول الأدوية المخصصة للعيادة (Custom Medications)
CREATE TABLE IF NOT EXISTS custom_medications (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول تصنيفات الأدوية المخصصة (Custom Categories)
CREATE TABLE IF NOT EXISTS custom_categories (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول المخازن والمستلزمات الطبية (Inventory)
CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول الفواتير والمدفوعات والمعاملات المالية (Billing)
CREATE TABLE IF NOT EXISTS billing (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول الإغلاقات المالية اليومية/الشهرية (Closings)
CREATE TABLE IF NOT EXISTS closings (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول معامل تركيبات الأسنان المتعامل معها (Laboratories)
CREATE TABLE IF NOT EXISTS laboratories (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول طلبات المعامل وحالات التركيبات (Lab Orders)
CREATE TABLE IF NOT EXISTS lab_orders (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول أنواع أعمال التركيبات المتوفرة (Lab Work Types)
CREATE TABLE IF NOT EXISTS lab_work_types (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول التجديدات والاشتراكات لـ SaaS (Renewals / Subscriptions)
CREATE TABLE IF NOT EXISTS renewals (
    id TEXT PRIMARY KEY,
    data TEXT,
    createdAt TEXT
);

-- جدول شفتات العمل ومواعيد الأطباء (Shifts)
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول المصروفات الإدارية للعيادة (Expenses)
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    data TEXT,
    createdAt TEXT
);

-- جدول الملفات والصور المرفوعة (Uploaded Files)
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    mimeType TEXT,
    data TEXT
);

-- جدول الإعلانات والإشعارات العامة للنظام (Announcements / Broadcasts)
CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    content TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT
);

-- جدول بيانات لوحة السوبر أدمين (Superadmin Credentials)
CREATE TABLE IF NOT EXISTS superadmin_credentials (
    id TEXT PRIMARY KEY,
    email TEXT,
    password TEXT,
    updatedAt TEXT
);

-- جدول إعدادات النظام العامة (System Settings)
CREATE TABLE IF NOT EXISTS system_settings (
    id TEXT PRIMARY KEY,
    data TEXT,
    createdAt TEXT
);

-- جدول أحداث المزامنة الفورية للسيرفر (Real-time Sync Events)
CREATE TABLE IF NOT EXISTS server_sync_events (
    id TEXT PRIMARY KEY,
    clinicId TEXT,
    clinic_id TEXT,
    table_name TEXT,
    action TEXT,
    record_id TEXT,
    created_at BIGINT,
    payload TEXT
);

-- ---------------------------------------------------------------------
-- 3. إنشاء الفهارس لضمان السرعة الفائقة في البحث والاستعلام (Indexes)
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_server_sync_events_clinic ON server_sync_events(clinicId);
CREATE INDEX IF NOT EXISTS idx_server_sync_events_time ON server_sync_events(created_at);

CREATE INDEX IF NOT EXISTS idx_clinics_id ON clinics(clinicId);
CREATE INDEX IF NOT EXISTS idx_users_clinic ON users(clinicId);
CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinicId);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic ON appointments(clinicId);
CREATE INDEX IF NOT EXISTS idx_records_clinic ON records(clinicId);
CREATE INDEX IF NOT EXISTS idx_records_patient ON records(patientId);
CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic ON prescriptions(clinicId);
CREATE INDEX IF NOT EXISTS idx_inventory_clinic ON inventory(clinicId);
CREATE INDEX IF NOT EXISTS idx_billing_clinic ON billing(clinicId);
CREATE INDEX IF NOT EXISTS idx_shifts_clinic ON shifts(clinicId);
CREATE INDEX IF NOT EXISTS idx_expenses_clinic ON expenses(clinicId);
CREATE INDEX IF NOT EXISTS idx_lab_orders_clinic ON lab_orders(clinicId);

-- =====================================================================
-- تمت التهيئة بنجاح!
-- يمكنك نسخ هذا الكود بالكامل وتشغيله في أي أداة لإدارة PostgreSQL 
-- مثل: pgAdmin, phpPgAdmin, Supabase SQL Editor, DBeaver, إلخ.
-- =====================================================================
