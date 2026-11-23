import { isDeepStrictEqual } from 'node:util';
import crypto from 'node:crypto';
import { getClinicPaymentMethods, samePaymentMethod, normalizePaymentMethod } from '../src/utils/paymentMethods';
import { CREDENTIAL_SCHEMA_VERSION, clinicCredentialCopy, adminCredentialCopy, validateClinicCredentials, validateBackupHash, restoreClinicCredentials, safeRestoredStaff, credentialNotice } from './backupCredentials';
const TABLES = ['patients', 'appointments', 'records', 'teeth', 'xrays', 'prescriptions', 'custom_medications', 'custom_categories', 'shifts', 'expenses', 'inventory', 'billing', 'closings', 'laboratories', 'lab_orders', 'lab_work_types'];
const ALIASES: any = { custom_medications: 'customMedications', custom_categories: 'customCategories', closings: 'dailyClosings', lab_orders: 'labOrders', lab_work_types: 'labWorkTypes', expenses: 'expenseList' };
const err = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const unpack = (row: any) => { const { data, ...cols } = row; return { ...cols, ...(typeof data === 'string' ? JSON.parse(data || '{}') : data || {}), id: row.id }; };
const equivalent = (a: any, b: any) => isDeepStrictEqual(a ?? null, b ?? null);
export function createBackupService({ db, getAuth, finance, mapColumns, sanitizeClinic, secureClinic, hashPassword, defaultAdmin, broadcast }: any) {
    const read = async (table: string, cid?: string) => (await db.execute({ sql: `SELECT * FROM ${table}${cid ? ' WHERE clinicId = ?' : ''}`, args: cid ? [cid] : [] })).rows.map(unpack);
    const one = async (table: string, id: string) => { const rows = (await db.execute({ sql: `SELECT * FROM ${table} WHERE id = ?`, args: [id] })).rows; return rows.length ? unpack(rows[0]) : null; };
    async function put(table: string, id: string, data: any, cid?: string) {
        const old = await one(table, id);
        if (old && cid && table !== 'clinics' && String(old.clinicId || old.clinicid) !== cid)
            err('Backup record belongs to another clinic / السجل يخص عيادة أخرى', 403);
        const full = { ...(old || {}), ...data, id, ...(cid && table !== 'clinics' ? { clinicId: cid } : {}) };
        delete full.data;
        const { cols, vals } = mapColumns(table, id, full, cid, full.patientId, full.createdAt || new Date().toISOString());
        if (old) {
            const pairs = cols.map((c: string, i: number) => ({ c, v: vals[i] })).filter((x: any) => x.c !== 'id');
            await db.execute({ sql: `UPDATE ${table} SET ${pairs.map((x: any) => x.c + ' = ?').join(', ')} WHERE id = ?`, args: [...pairs.map((x: any) => x.v), id] });
        }
        else
            await db.execute({ sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, args: vals });
        return full;
    }
    async function readFinance(cid: string) { return finance.exportState(cid); }
    async function exportClinic(cid: string) {
        await finance.ensureSchema();
        return db.financeTransaction(cid, async () => {
            const clinic = await one('clinics', cid);
            if (!clinic)
                err('Clinic not found / العيادة غير موجودة', 404);
            const data: any = {};
            for (const table of TABLES)
                data[table] = await read(table, cid);
            data.patients = data.patients.map((p: any) => ({ ...p, ...Object.fromEntries(['records', 'teeth', 'xrays'].map(table => [table, data[table].filter((r: any) => r.patientId === p.id)])) }));
            data.finance_state = await readFinance(cid);
            return { schemaVersion: 3, credentialSchemaVersion: CREDENTIAL_SCHEMA_VERSION, fileType: 'CLINIC_DATABASE_BACKUP', platform: 'Clinic SaaS System', exportTimestamp: new Date().toISOString(), clinicId: cid, clinicName: clinic.name, clinicInfo: await clinicCredentialCopy(clinic, hashPassword), data };
        });
    }
    function normalize(input: any) {
        if (!input || typeof input !== 'object' || Array.isArray(input))
            err('Invalid backup / ملف غير صالح');
        const data = input.data || input, tables: any = {};
        for (const table of TABLES) {
            const value = data[table] ?? data[ALIASES[table]];
            if (value !== undefined && !Array.isArray(value))
                err('Invalid backup table: ' + table);
            tables[table] = value ? [...value] : [];
        }
        if (!TABLES.some(table => Array.isArray(data[table] ?? data[ALIASES[table]])))
            err('No supported records in backup / لا توجد سجلات متوافقة');
        tables.patients = tables.patients.map((p: any) => ({ ...p, id: String(p.id || p.phone || crypto.randomUUID()) }));
        for (const p of tables.patients)
            for (const table of ['records', 'teeth', 'xrays'])
                if (Array.isArray(p[table]))
                    tables[table].push(...p[table].map((r: any) => ({ ...r, patientId: p.id || p.phone })));
        // A nested legacy format and a new flat format can name the same record.
        for (const table of TABLES) {
            const unique = new Map();
            for (const row of tables[table]) {
                if (!row || typeof row !== 'object' || Array.isArray(row))
                    err('Invalid record: ' + table);
                const id = String(row.id || (table === 'patients' ? row.phone : '') || crypto.randomUUID());
                if (!id || id.length > 200)
                    err('Invalid record id');
                unique.set(id, { ...row, id });
            }
            tables[table] = [...unique.values()];
        }
        const state = data.finance_state ?? data.financeState ?? input.finance_state;
        if (state !== undefined && (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.receipts) || !Array.isArray(state.events) || !state.requests || typeof state.requests !== 'object' || Array.isArray(state.requests)))
            err('Invalid financial history / سجل مالي غير صالح');
        if (state?.assignments !== undefined && (!state.assignments || typeof state.assignments !== 'object' || Array.isArray(state.assignments)))
            err('Invalid financial assignments');
        if (state)
            for (const group of ['receipts', 'events'])
                for (const row of state[group]) {
                    if (!row?.id || typeof row.id !== 'string')
                        err('Invalid financial history id');
                    if (group === 'receipts' && (!Number.isInteger(row.amountCents) || row.amountCents < 0))
                        err('Invalid receipt cents / قيمة إيصال غير صالحة');
                }
        if (state)
            for (const entry of Object.values(state.requests) as any[]) {
                if (!entry || typeof entry !== 'object')
                    err('Invalid financial request');
                if (entry.recordRef && (![...TABLES, 'clinics'].includes(entry.recordRef.table) || typeof entry.recordRef.id !== 'string'))
                    err('Invalid financial reference');
            }
        const info = input.clinicInfo || {};
        if (!info || typeof info !== 'object' || Array.isArray(info)) err('Invalid clinic profile / بيانات عيادة غير صالحة');
        const sourceIds = [input.clinicId, info.id].filter(id => id !== undefined && id !== null && id !== '').map(String);
        if (new Set(sourceIds).size > 1) err('Conflicting clinic identifiers / أرقام عيادات متعارضة', 403);
        validateClinicCredentials(info, input.credentialSchemaVersion);
        return { info, sourceId: sourceIds[0] || '', credentialVersion: input.credentialSchemaVersion, tables, state };
    }
    function mergeState(current: any, incoming: any) {
        if (!incoming)
            return current;
        const merged = { ...current, ...incoming };
        for (const group of ['receipts', 'events']) {
            const map = new Map<string, any>((current[group] || []).map((r: any) => [r.id, r]));
            for (const row of incoming[group]) {
                if (map.has(row.id) && !equivalent(map.get(row.id), row))
                    err('Conflicting immutable financial history / تعارض في تاريخ مالي محفوظ', 409);
                map.set(row.id, row);
            }
            merged[group] = [...map.values()];
        }
        for (const group of ['requests', 'assignments']) {
            if (!current[group] && !incoming[group])
                continue;
            merged[group] = { ...(current[group] || {}) };
            for (const [key, value] of Object.entries(incoming[group] || {})) {
                if (Object.hasOwn(merged[group], key) && !equivalent(merged[group][key], value))
                    err('Conflicting financial request / تعارض طلب مالي', 409);
                Object.defineProperty(merged[group], key, { value, enumerable: true, writable: true, configurable: true });
            }
        }
        return merged;
    }
    async function restoreClinic(cid: string, input: any, auth: any) {
        const parsed = normalize(input);
        if (parsed.sourceId && parsed.sourceId !== cid) err('Backup belongs to another clinic / النسخة تخص عيادة أخرى', 403);
        await finance.ensureSchema();
        return db.financeTransaction(cid, async () => {
            const oldClinic = await one('clinics', cid);
            if (!oldClinic && auth.type !== 'admin')
                err('Clinic not found / العيادة غير موجودة', 404);
            let info = { ...parsed.info, id: cid };
            if (auth.type !== 'admin') {
                // Platform grants stay outside a manager's restore authority.
                const allowed = new Set(['name', 'nameAr', 'nameEn', 'logoUrl', 'doctorName', 'doctorNameEn', 'doctorPhone', 'additionalPhones', 'doctorSpecialtyAr', 'doctorSpecialtyEn', 'clinicHours', 'address', 'prescriptionStyle', 'prescriptionLayout', 'customPrescriptionPadConfig', 'consultationPrice', 'bookingSystemMode', 'questionnaireQuestions', 'customDentalServices', 'orthodonticCatalogVersion', 'dentalServiceCategories', 'paymentMethods', 'dentalChartStyleSettings', 'autoBackupEnabled', 'autoBackupFormat', 'loyaltyProgramEnabled', 'loyaltyEarnEgpThreshold', 'loyaltyEarnPoints', 'loyaltyRedeemPointsThreshold', 'loyaltyRedeemDiscountEgp', 'loyaltyMinRedeemPoints']);
                info = Object.fromEntries(Object.entries(info).filter(([key]) => allowed.has(key)));
                if (parsed.credentialVersion === CREDENTIAL_SCHEMA_VERSION) {
                    const recovered = safeRestoredStaff(parsed.info);
                    for (const key of ['password', 'staffPin', 'staffMembers']) if (recovered[key] !== undefined) info[key] = recovered[key];
                }
            }
            info = restoreClinicCredentials(info, oldClinic, parsed.credentialVersion);
            const configured = getClinicPaymentMethods(info.paymentMethods ?? oldClinic?.paymentMethods);
            for (const name of oldClinic ? getClinicPaymentMethods(oldClinic.paymentMethods) : [])
                if (!configured.some(m => samePaymentMethod(m, name)))
                    configured.push(name);
            const state = mergeState(await readFinance(cid), parsed.state);
            for (const receipt of state.receipts || [])
                if (receipt.paymentMethod && normalizePaymentMethod(receipt.paymentMethod) !== 'نقاط الولاء' && !configured.some(m => samePaymentMethod(m, receipt.paymentMethod)))
                    configured.push(normalizePaymentMethod(receipt.paymentMethod));
            await finance.validateClinicPaymentMethods(cid, configured, auth);
            info = await secureClinic({ ...oldClinic, ...info, paymentMethods: configured }, oldClinic);
            // Write-time migration must not trim or replace current legacy secrets either.
            info = restoreClinicCredentials(info, oldClinic, parsed.credentialVersion);
            // Preflight financial conflicts before writing. Restore is merge-only and
            // never rewinds already-recorded money or reopens an immutable closed shift.
            const protectedFields: any = { patients: ['loyaltyPoints'], appointments: ['paidAmount', 'payments', 'price', 'remainingAmount', 'discount'], expenses: ['amount', 'paymentMethod', 'shiftId', 'deletedAt'], lab_orders: ['paidAmount', 'paymentMethod', 'cost', 'status'], shifts: ['status', 'snapshot', 'startCash', 'expectedCash', 'actualCash', 'totalRevenue', 'cashRevenue', 'cardRevenue', 'instapayRevenue', 'walletRevenue', 'expensesTotal', 'cashExpenses', 'remainingRevenue', 'discrepancy', 'closedAt', 'closedBy', 'openedAt'], billing: ['paidAmount', 'remainingAmount', 'totalAmount'], closings: ['snapshot', 'totalIncome', 'totalExpenses'] };
            for (const table of TABLES)
                for (const row of parsed.tables[table]) {
                    const declaredClinic = row.clinicId ?? row.clinicid ?? row.clinic_id;
                    if (declaredClinic !== undefined && declaredClinic !== null && declaredClinic !== '' && String(declaredClinic) !== cid)
                        err('Backup record belongs to another clinic / السجل يخص عيادة أخرى', 403);
                    const old = await one(table, row.id);
                    if (old && String(old.clinicId || old.clinicid) !== cid)
                        err('Backup record belongs to another clinic / السجل يخص عيادة أخرى', 403);
                    if (old)
                        for (const key of protectedFields[table] || [])
                            if (row[key] !== undefined && !equivalent(old[key], row[key]))
                                err('Restore conflicts with current financial data; no changes saved / النسخة تتعارض مع بيانات مالية حالية، لم تحفظ تغييرات', 409);
                    for (const key of ['amount', 'paidAmount', 'cost', 'price'])
                        if (row[key] !== undefined && (!Number.isFinite(Number(row[key])) || Number(row[key]) < 0))
                            err('Invalid backup amount / مبلغ غير صالح');
                }
            for (const request of Object.values(state.requests || {}) as any[]) {
                const ref = request?.recordRef;
                if (!ref) continue;
                if (ref.table === 'clinics' && ref.id !== cid) err('Financial reference belongs to another clinic / مرجع مالي لعيادة أخرى', 403);
                if (ref.table !== 'clinics') {
                    const record = await one(ref.table, ref.id);
                    if (record && String(record.clinicId || record.clinicid) !== cid) err('Financial reference belongs to another clinic / مرجع مالي لعيادة أخرى', 403);
                }
            }
            const incomingApps = new Set(parsed.tables.appointments.map((a: any) => a.id));
            for (const receipt of state.receipts || [])
                if (receipt.appointmentId && !incomingApps.has(receipt.appointmentId)) {
                    const app = await one('appointments', receipt.appointmentId);
                    if (!app || String(app.clinicId || app.clinicid) !== cid)
                        err('Receipt appointment missing / موعد الإيصال غير موجود');
                }
            await put('clinics', cid, info);
            const counts: any = {};
            for (const table of TABLES) {
                counts[table] = 0;
                for (const raw of parsed.tables[table]) {
                    const row = { ...raw };
                    delete row.data;
                    if (table === 'patients') {
                        delete row.records;
                        delete row.teeth;
                        delete row.xrays;
                    }
                    await put(table, row.id, { ...row, clinicId: cid }, cid);
                    counts[table]++;
                }
            }
            await finance.importState(cid,state);
            return { success: true, counts, clinicInfo: sanitizeClinic(info), credentialNotice, warnings: [...(parsed.state ? [] : ['Legacy backup has no financial event/request history. Existing history was kept; missing history cannot be recovered. / النسخة القديمة لا تحتوي على تاريخ الأحداث والطلبات المالية. تم الاحتفاظ بالتاريخ الحالي، ولا يمكن استعادة ما لم يكن محفوظا.']), ...(parsed.credentialVersion ? [] : ['Legacy backup has no guaranteed login hashes. Current logins were kept; missing passwords cannot be recovered from this file. / النسخة القديمة لا تضمن حفظ هاشات الدخول. تم الاحتفاظ بالحسابات الحالية، ولا يمكن استرجاع كلمات مرور غير محفوظة بالملف.'])] };
        });
    }
    const legacyItem = (b: any) => { const { data } = b; return { credentialSchemaVersion: b.credentialSchemaVersion, clinicInfo: b.clinicInfo, ...data, customMedications: data.custom_medications, customCategories: data.custom_categories, dailyClosings: data.closings, labOrders: data.lab_orders, labWorkTypes: data.lab_work_types }; };
    async function handler(req: any, res: any) {
        try {
            const auth = await getAuth(req);
            if (!auth)
                err('Authentication required / يلزم تسجيل الدخول', 401);
            if (auth.type === 'staff' && req.body?.action !== 'export_clinic')
                err('Manager only / للمدير فقط', 403);
            const { action, clinicId, backup } = req.body || {};
            const cid = String(clinicId || auth.clinicId || '');
            if (auth.type !== 'admin' && (String(auth.clinicId) !== cid || !['export_clinic', 'restore_clinic'].includes(action)))
                err('Forbidden / غير مصرح', 403);
            if (action === 'export_clinic')
                return res.json(await exportClinic(cid));
            if (action === 'restore_clinic') {
                const result = await restoreClinic(cid, backup, auth);
                for (const table of ['clinics', ...TABLES])
                    broadcast(cid, { table, action: 'backup-restored' });
                return res.json(result);
            }
            if (action === 'export_system') {
                const clinics = [];
                for (const c of await read('clinics'))
                    clinics.push(legacyItem(await exportClinic(c.id)));
                const adminRows = (await read('superadmin_credentials')).filter((row: any) => row.id === 'main');
                const superadminCredentials = [];
                for (const row of adminRows.length ? adminRows : defaultAdmin ? [{ id: 'main', ...defaultAdmin }] : []) {
                    const copy = await adminCredentialCopy(row, hashPassword);
                    if (copy) superadminCredentials.push(copy);
                }
                return res.json({ schemaVersion: 3, credentialSchemaVersion: CREDENTIAL_SCHEMA_VERSION, superadminCredentials, platform: 'CrownDent Multi-Tenant System Master', backupScope: 'FULL_SYSTEM_BACKUP', backupTimestamp: new Date().toISOString(), totalClinicsCount: clinics.length, clinics, renewalsLog: await read('renewals'), broadcasts: await read('announcements'), systemSettings: (await read('system_settings')).filter((s: any) => s.id !== 'auth_secret') });
            }
            if (action === 'restore_system') {
                if (!Array.isArray(backup?.clinics))
                    err('Invalid system backup / نسخة نظام غير صالحة');
                // Parse every clinic first so malformed files never start a partial restore.
                const clinicIds = new Set<string>();
                for (const item of backup.clinics) {
                    normalize(item);
                    const id = String(item.clinicInfo?.id || item.clinicId || '');
                    if (!id || clinicIds.has(id))
                        err('Missing or duplicate clinic id');
                    clinicIds.add(id);
                }
                for (const key of ['renewalsLog', 'broadcasts', 'systemSettings'])
                    if (backup[key] !== undefined) {
                        if (!Array.isArray(backup[key]))
                            err('Invalid global backup records');
                        for (const row of backup[key])
                            if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || row.id.length > 200)
                                err('Invalid global record');
                    }
                if (backup.superadminCredentials !== undefined) {
                    if (!Array.isArray(backup.superadminCredentials) || backup.superadminCredentials.length > 1) err('Invalid platform credentials / حساب منصة غير صالح');
                    for (const row of backup.superadminCredentials) {
                        if (row?.id !== 'main' || typeof row.email !== 'string' || !row.email.trim() || typeof row.password !== 'string' || !row.password) err('Invalid platform credentials / حساب منصة غير صالح');
                        validateBackupHash(row.password);
                    }
                }
                const completed: string[] = [];
                try {
                    for (const item of backup.clinics) {
                        const id = String(item.clinicInfo?.id || item.clinicId || '');
                        if (!id)
                            err('Missing clinic id');
                        await restoreClinic(id, item, auth);
                        completed.push(id);
                        for (const table of ['clinics', ...TABLES])
                            broadcast(id, { table, action: 'backup-restored' });
                    }
                    for (const [key, table] of [['renewalsLog', 'renewals'], ['broadcasts', 'announcements'], ['systemSettings', 'system_settings']])
                        for (const row of backup[key] || []) {
                            if (row.id && !(table === 'system_settings' && row.id === 'auth_secret'))
                                await put(table, row.id, row, row.clinicId);
                        }
                    // A platform archive can fill an absent account, never replace a live one.
                    for (const row of backup.superadminCredentials || []) {
                        await db.financeTransaction('backup-platform-credentials', async () => {
                            if (!(await one('superadmin_credentials', 'main')))
                                await db.execute({ sql: 'INSERT INTO superadmin_credentials (id, email, password, updatedAt) VALUES (?, ?, ?, ?)', args: ['main', row.email, row.password, row.updatedAt || new Date().toISOString()] });
                        });
                    }
                }
                catch (e: any) {
                    throw Object.assign(e, { message: e.message + ' (completed clinics: ' + completed.join(', ') + ')' });
                }
                return res.json({ success: true, restoredClinics: completed, credentialNotice, warnings: backup.clinics.some((c: any) => !(c.data || c).finance_state || !c.credentialSchemaVersion) ? ['Legacy backup: missing financial history or login hashes cannot be recovered. Existing history and logins were kept. / نسخة قديمة: لا يمكن استرجاع تاريخ مالي أو هاشات دخول غير محفوظة. تم الاحتفاظ بالتاريخ والحسابات الحالية.'] : [] });
            }
            err('Unknown backup action / عملية غير مدعومة');
        }
        catch (e: any) {
            res.status(e.status || 500).json({ message: e.message || 'Backup failed / فشل النسخ الاحتياطي' });
        }
    }
    // Streams the full-system backup JSON in legacy flat shape, one clinic at a time.
    async function streamSystemExport(write: (chunk: string) => void | Promise<void>) {
        const clinics = await read('clinics');
        const adminRows = (await read('superadmin_credentials')).filter((row: any) => row.id === 'main');
        const superadminCredentials = [];
        for (const row of adminRows.length ? adminRows : defaultAdmin ? [{ id: 'main', ...defaultAdmin }] : []) {
            const copy = await adminCredentialCopy(row, hashPassword);
            if (copy) superadminCredentials.push(copy);
        }
        await write('{"schemaVersion":3,"credentialSchemaVersion":' + CREDENTIAL_SCHEMA_VERSION + ',"superadminCredentials":' + JSON.stringify(superadminCredentials) + ',"platform":"CrownDent Multi-Tenant System Master","backupScope":"FULL_SYSTEM_BACKUP","backupTimestamp":' + JSON.stringify(new Date().toISOString()) + ',"totalClinicsCount":' + clinics.length + ',"clinics":[');
        let first = true;
        for (const c of clinics) {
            await write((first ? '' : ',') + JSON.stringify(legacyItem(await exportClinic(c.id))));
            first = false;
        }
        await write('],"renewalsLog":' + JSON.stringify(await read('renewals')) + ',"broadcasts":' + JSON.stringify(await read('announcements')) + ',"systemSettings":' + JSON.stringify((await read('system_settings')).filter((s: any) => s.id !== 'auth_secret')) + '}');
    }
    return { handler, validateClinic: normalize, restoreClinic, streamSystemExport };
}
