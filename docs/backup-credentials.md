# Login credentials in application backups

JSON, DB, ZIP and SQL exports use the existing backup endpoint and formats. New exports carry `credentialSchemaVersion: 1` and scrypt hashes with their salts for clinic-owner passwords, shared staff PINs and individual staff passwords. Full-platform exports also carry the superadmin credential record. Staff-role downloads include their own clinic's hashes, as requested. Ordinary clinic API responses still omit credentials.

- Legacy plaintext is hashed in the exported copy only. Export does not change source passwords. Existing valid hashes are copied without hashing them again. Obsolete nested clinic/staff snapshots are omitted.
- On an existing DB, restore keeps current owner login identity, passwords/PINs, staff access, post-backup staff and platform credentials. Missing staff are added from the backup. Existing accounts are not removed or reset.
- On a new DB, a superadmin imports the clinic or platform file. Recovered accounts use the passwords saved when that file was made. A password changed after the backup cannot be recovered from the older file.
- Staff cannot restore. Clinic owners cannot restore another clinic or platform settings. New credential payloads reject malformed hashes. Import authorization prevents crossing those boundaries, but an unsigned file does not prove its origin or that it was never modified.
- These files are not encrypted. Hashes are sensitive and can be attacked offline. Store backups privately and import only files you trust. The server's session-signing secret is never exported.
- DB is the existing application archive, not a native PostgreSQL dump. SQL retains its readable tables and complete JSON marker; the application's importer reads that marker and does not execute uploaded SQL.
- Older files remain importable, but cannot recover passwords or financial history that they never contained. Platform restore remains atomic per clinic, not across the whole platform. The existing upload-size limit is unchanged.

`npm run test:backup-credentials` tests isolated HTTP servers, including a 200-clinic platform restore and login recovery with a different target session-signing key. `npm run test:backups` also tests actual browser downloads in every format, all existing UI export routes, financial history, rollback and Arabic/English result notes. These are not production or live PostgreSQL disaster-recovery tests.

## بيانات الدخول في النسخ الاحتياطية

الصيغ الحالية JSON وDB وZIP وSQL تشمل هاشات كلمات مرور مالك العيادة والموظفين ورمز دخول الطاقم، مع الـ salt. نسخة المنصة الكاملة تشمل حساب مدير النظام أيضا. نسخة السكرتير تشمل هاشات عيادته فقط. استجابات البيانات العادية لا تعرض هذه القيم.

- تتحول القيم القديمة غير المهاشة إلى هاش داخل ملف التصدير فقط، دون تغيير كلمات المرور في المصدر. الهاشات الحالية لا يعاد تشفيرها أو تغييرها.
- الاستعادة على قاعدة موجودة تحافظ على بيانات الدخول والصلاحيات الحالية ولا تحذف الموظفين الذين أضيفوا بعد النسخة. الحسابات الناقصة تسترجع بياناتها من الملف.
- الاستعادة على قاعدة جديدة تتم بواسطة مدير النظام، وتعيد كلمات المرور المحفوظة وقت أخذ النسخة. كلمة مرور تغيرت بعد النسخة لا يمكن استرجاعها من الملف الأقدم.
- السكرتير لا يستطيع الاستعادة، ومالك العيادة لا يستطيع تعديل عيادة أخرى أو صلاحيات المنصة من خلال الملف. الصلاحيات وفحص الهاشات لا يثبتان أن ملفا غير موقع لم يتعرض للتعديل.
- الملفات غير مشفرة، والهاشات بيانات حساسة قابلة لمحاولات التخمين خارج السيرفر. تحفظ النسخ بشكل خاص ولا تستورد إلا من مصدر موثوق. مفتاح توقيع جلسات السيرفر لا يصدر.
- ملف DB هو أرشيف التطبيق الحالي وليس نسخة PostgreSQL أصلية. استيراد SQL في التطبيق يقرأ علامة البيانات الكاملة ولا ينفذ أوامر SQL المرفوعة.
- النسخ القديمة لا تستطيع استعادة كلمات مرور أو سجل مالي لم يكن محفوظا فيها. استعادة المنصة تتم بمعاملة مستقلة لكل عيادة، وحد حجم الرفع الحالي لم يتغير.

الاختبارات المعزولة تشمل نسخة منصة بها 200 عيادة، ونجاح دخول المالك والطبيب والسكرتير والرمز السري ومدير النظام، مع مفتاح جلسات مختلف على السيرفر الجديد. تشمل أيضا تنزيل الصيغ الأربع فعليا، ورسائل النتيجة بالعربية والإنجليزية. ليست هذه اختبارات على قاعدة الإنتاج أو PostgreSQL الفعلي.
