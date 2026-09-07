# PostgreSQL Database Setup Guide | دليل إعداد قاعدة بيانات PostgreSQL

This system is fully optimized for **PostgreSQL** (the preferred database for production deployment on Hostinger, Supabase, Neon, etc.). 

The system features **automatic database initialization**. When you run the application and connect it to your PostgreSQL database, it will automatically create all necessary tables, columns, and compatibility functions!

---

## 🇸🇦 1. الإعداد والتشغيل على هوستينجر (Hostinger) أو أي خادم آخر

### الخطوة 1: إنشاء قاعدة بيانات PostgreSQL
1. قم بتسجيل الدخول إلى لوحة تحكم هوستينجر (Hostinger hPanel).
2. انتقل إلى **Databases** -> **PostgreSQL Databases**.
3. قم بإنشاء قاعدة بيانات جديدة:
   - اسم قاعدة البيانات (Database Name)
   - اسم المستخدم (Database User)
   - كلمة المرور (Database Password)
4. احفظ هذه البيانات لأننا سنستخدمها لإنشاء رابط الاتصال.

### الخطوة 2: ربط قاعدة البيانات بالنظام
قم بتعريف متغير البيئة (Environment Variable) باسم `DATABASE_URL` في لوحة تحكم هوستينجر الخاصة بك بالقيمة التالية:
```env
DATABASE_URL="postgresql://اسم_المستخدم:كلمة_المرور@اسم_المستضيف:5432/اسم_قاعدة_البيانات?sslmode=require"
```
*(إذا لم يكن خادم قاعدة البيانات يدعم أو يتطلب الاتصال المشفر SSL، يمكنك إزالة `?sslmode=require`).*

### الخطوة 3: التشغيل التلقائي
بمجرد تشغيل التطبيق وتوصيله بقاعدة البيانات، سيقوم السيرفر تلقائيًا بإنشاء:
- جدول `server_sync_events` لمزامنة البيانات الفورية.
- جداول العيادات والملفات الطبية والروشتات والحسابات.
- دالة `json_extract` المخصصة للبحث المتقدم داخل حقول الـ JSON.

---

## 🇬🇧 2. Configuration & Deployment Guide

### Step 1: Create a PostgreSQL Database
1. Go to your hosting control panel (e.g., Hostinger hPanel, Supabase, Neon, or Aiven).
2. Create a new PostgreSQL Database and retrieve the database credentials:
   - Host
   - Port (Default: 5432)
   - Database Name
   - User
   - Password

### Step 2: Configure Environment Variables
Set the `DATABASE_URL` environment variable on your server environment:
```env
DATABASE_URL="postgresql://username:password@hostname:5432/database_name?sslmode=require"
```

### Step 3: Automated Database Migration
The backend is designed to handle schema setup automatically. On startup, the server checks the connection and runs:
1. Schema initialization for all clinical tables (`clinics`, `patients`, `appointments`, `billing`, etc.).
2. High-performance JSON-compat extraction functions (`json_extract` PL/pgSQL).
3. Real-time synchronization event tables.

No manual `.sql` file importing is required!
