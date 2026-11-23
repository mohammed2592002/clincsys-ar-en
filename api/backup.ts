import { isDeepStrictEqual } from 'node:util';
import crypto from 'node:crypto';
import { checkExportMemory, EXPORT_WRITE_BYTES } from './exportLimits';
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
    // Batched reads/writes for restore on PostgreSQL; the local JSON emulator keeps
    // the per-row put()/one() path because it only parses single-row statements.
    async function readMany(table: string, ids: string[]) {
        const found = new Map<string, any>();
        for (let i = 0; i < ids.length; i += 500) {
            const chunk = ids.slice(i, i + 500);
            if (!chunk.length) continue;
            const rows = (await db.execute({ sql: `SELECT * FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`, args: chunk })).rows;
            for (const row of rows) found.set(String(row.id), unpack(row));
        }
        return found;
    }
    async function putMany(table: string, rows: any[], cid: string) {
        // Same merge and column mapping as put(), grouped by column signature
        // (patientId is only mapped for rows that have one) into multi-row upserts.
        const groups = new Map<string, { cols: string[], vals: any[][] }>();
        for (const row of rows) {
            const { cols, vals } = mapColumns(table, row.id, row, cid, row.patientId, row.createdAt || new Date().toISOString());
            const key = cols.join(',');
            if (!groups.has(key)) groups.set(key, { cols, vals: [] });
            groups.get(key)!.vals.push(vals);
        }
        for (const { cols, vals } of groups.values()) {
            const updates = cols.filter(c => c !== 'id').map(c => `${c} = EXCLUDED.${c}`).join(', ');
            for (let i = 0; i < vals.length; i += 500) {
                const chunk = vals.slice(i, i + 500);
                await db.execute({ sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.map(v => `(${v.map(() => '?').join(',')})`).join(', ')} ON CONFLICT (id) DO UPDATE SET ${updates}`, args: chunk.flat() });
            }
        }
    }
    async function readFinance(cid: string) { return finance.exportState(cid); }
    // Single-clinic export with the exact legacy JSON shape, serialized from
    // keyset-batched reads so one backup never materializes the whole clinic.
    async function streamClinicExport(cid: string, write: (chunk: string) => Promise<void>, check: () => void) {
        await finance.ensureSchema();
        await db.financeTransaction(cid, async () => {
            const clinic = await one('clinics', cid);
            if (!clinic)
                err('Clinic not found / العيادة غير موجودة', 404);
            await write('{"schemaVersion":3,"credentialSchemaVersion":' + CREDENTIAL_SCHEMA_VERSION + ',"fileType":"CLINIC_DATABASE_BACKUP","platform":"Clinic SaaS System","exportTimestamp":' + JSON.stringify(new Date().toISOString()) + ',"clinicId":' + JSON.stringify(cid) + ',"clinicName":' + JSON.stringify(clinic.name) + ',"clinicInfo":' + JSON.stringify(await clinicCredentialCopy(clinic, hashPassword)) + ',"data":{');
            const BATCH = 1000;
            let firstTable = true;
            const batches = async (table: string, extra?: { column: string, ids: string[] }) => {
                const out: any[] = [];
                let last = '';
                while (true) {
                    check();
                    const where = ['clinicId = ?', ...(last ? ['id > ?'] : []), ...(extra ? [`${extra.column} IN (${extra.ids.map(() => '?').join(',')})`] : [])];
                    const args = [cid, ...(last ? [last] : []), ...(extra ? extra.ids : [])];
                    const rows = (await db.execute({ sql: `SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ${BATCH}`, args })).rows;
                    out.push(...rows);
                    if (rows.length < BATCH) break;
                    last = rows[rows.length - 1].id;
                }
                return out;
            };
            for (const table of TABLES) {
                check();
                await write((firstTable ? '' : ',') + JSON.stringify(table) + ':[');
                firstTable = false;
                if (table !== 'patients') {
                    let firstRow = true, last = '';
                    while (true) {
                        check();
                        const rows = (await db.execute({ sql: `SELECT * FROM ${table} WHERE clinicId = ?${last ? ' AND id > ?' : ''} ORDER BY id ASC LIMIT ${BATCH}`, args: last ? [cid, last] : [cid] })).rows;
                        for (const row of rows) { check(); await write((firstRow ? '' : ',') + JSON.stringify(unpack(row))); firstRow = false; }
                        if (rows.length < BATCH) break;
                        last = rows[rows.length - 1].id;
                    }
                } else {
                    let firstRow = true, last = '';
                    while (true) {
                        check();
                        const rows = (await db.execute({ sql: `SELECT * FROM patients WHERE clinicId = ?${last ? ' AND id > ?' : ''} ORDER BY id ASC LIMIT ${BATCH}`, args: last ? [cid, last] : [cid] })).rows;
                        if (rows.length) {
                            const ids = rows.map((row: any) => String(row.id));
                            // Nested copies are redundant with the flat tables (which
                            // normalize() treats as authoritative); kept for older readers.
                            const nested: any = {};
                            for (const nestedTable of ['records', 'teeth', 'xrays'])
                                nested[nestedTable] = (await batches(nestedTable, { column: 'patientId', ids })).map(unpack);
                            for (const row of rows) {
                                check();
                                const p = unpack(row);
                                await write((firstRow ? '' : ',') + JSON.stringify({ ...p, ...Object.fromEntries(['records', 'teeth', 'xrays'].map(t => [t, nested[t].filter((r: any) => r.patientId === p.id)])) }));
                                firstRow = false;
                            }
                        }
                        if (rows.length < BATCH) break;
                        last = rows[rows.length - 1].id;
                    }
                }
                await write(']');
            }
            await write(',"finance_state":');
            await finance.streamExport(cid, write, check);
            await write('}}');
        });
    }
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
            const batched = !!db.getIsPostgres?.();
            const existingByTable = new Map<string, Map<string, any>>();
            if (batched)
                for (const table of TABLES)
                    existingByTable.set(table, await readMany(table, parsed.tables[table].map((row: any) => String(row.id))));
            for (const table of TABLES)
                for (const row of parsed.tables[table]) {
                    const declaredClinic = row.clinicId ?? row.clinicid ?? row.clinic_id;
                    if (declaredClinic !== undefined && declaredClinic !== null && declaredClinic !== '' && String(declaredClinic) !== cid)
                        err('Backup record belongs to another clinic / السجل يخص عيادة أخرى', 403);
                    const old = batched ? existingByTable.get(table)!.get(String(row.id)) : await one(table, row.id);
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
            const refRows = new Map<string, Map<string, any>>();
            if (batched) {
                const refIds = new Map<string, Set<string>>();
                for (const request of Object.values(state.requests || {}) as any[]) {
                    const ref = request?.recordRef;
                    if (!ref || ref.table === 'clinics') continue;
                    if (!refIds.has(ref.table)) refIds.set(ref.table, new Set());
                    refIds.get(ref.table)!.add(String(ref.id));
                }
                for (const [table, ids] of refIds) refRows.set(table, await readMany(table, [...ids]));
            }
            for (const request of Object.values(state.requests || {}) as any[]) {
                const ref = request?.recordRef;
                if (!ref) continue;
                if (ref.table === 'clinics' && ref.id !== cid) err('Financial reference belongs to another clinic / مرجع مالي لعيادة أخرى', 403);
                if (ref.table !== 'clinics') {
                    const record = batched ? refRows.get(ref.table)?.get(String(ref.id)) : await one(ref.table, ref.id);
                    if (record && String(record.clinicId || record.clinicid) !== cid) err('Financial reference belongs to another clinic / مرجع مالي لعيادة أخرى', 403);
                }
            }
            const incomingApps = new Set(parsed.tables.appointments.map((a: any) => a.id));
            const missingAppIds: string[] = [...new Set<string>((state.receipts || []).filter((r: any) => r.appointmentId && !incomingApps.has(r.appointmentId)).map((r: any) => String(r.appointmentId)))];
            const appRows = batched ? await readMany('appointments', missingAppIds) : null;
            for (const receipt of state.receipts || [])
                if (receipt.appointmentId && !incomingApps.has(receipt.appointmentId)) {
                    const app = batched ? appRows!.get(String(receipt.appointmentId)) : await one('appointments', receipt.appointmentId);
                    if (!app || String(app.clinicId || app.clinicid) !== cid)
                        err('Receipt appointment missing / موعد الإيصال غير موجود');
                }
            await put('clinics', cid, info);
            const counts: any = {};
            for (const table of TABLES) {
                counts[table] = 0;
                const prepared: any[] = [];
                for (const raw of parsed.tables[table]) {
                    const row = { ...raw };
                    delete row.data;
                    if (table === 'patients') {
                        delete row.records;
                        delete row.teeth;
                        delete row.xrays;
                    }
                    if (!batched) {
                        await put(table, row.id, { ...row, clinicId: cid }, cid);
                    } else {
                        const old = existingByTable.get(table)!.get(String(row.id));
                        const full = { ...(old || {}), ...row, id: row.id, clinicId: cid };
                        delete full.data;
                        prepared.push(full);
                    }
                    counts[table]++;
                }
                if (batched && prepared.length) await putMany(table, prepared, cid);
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
            if (action === 'export_clinic') {
                // Same JSON body as before, streamed so large clinics stay under the memory ceiling.
                let started = false, pending: string[] = [], pendingBytes = 0;
                const controller = new AbortController();
                res.on('close', () => { if (!res.writableFinished) controller.abort(); });
                const flush = async () => { if (!pending.length) return; const chunk = pending.join(''); pending = []; pendingBytes = 0; res.write(chunk); };
                const write = async (chunk: string) => {
                    if (!started) { started = true; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); }
                    const bytes = Buffer.byteLength(chunk);
                    if (pendingBytes + bytes > EXPORT_WRITE_BYTES) await flush();
                    if (bytes >= EXPORT_WRITE_BYTES) { res.write(chunk); return; }
                    pending.push(chunk); pendingBytes += bytes;
                };
                const check = () => { checkExportMemory(); if (controller.signal.aborted) throw Object.assign(new Error('Export aborted'), { code: 'EXPORT_ABORTED' }); };
                try {
                    await streamClinicExport(cid, write, check);
                    await flush();
                    res.end();
                    return;
                } catch (e: any) {
                    if (started) { res.end(); return; }
                    throw e;
                }
            }
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
    // Bounded row batches preserve the format without materializing a clinic.
    async function streamSystemExport(sink:(chunk:string)=>Promise<void>, options:any={}) {
        // Bound accumulated output by bytes, while avoiding a zlib write per row.
        let pending:string[]=[],pendingBytes=0;
        const flush=async()=>{if(!pending.length)return;const chunk=pending.join('');pending=[];pendingBytes=0;await sink(chunk);};
        const write=async(chunk:string)=>{check();const bytes=Buffer.byteLength(chunk);if(pendingBytes+bytes>EXPORT_WRITE_BYTES)await flush();if(bytes>=EXPORT_WRITE_BYTES){await sink(chunk);return;}pending.push(chunk);pendingBytes+=bytes;};
        const check=()=>{checkExportMemory();if(options.signal?.aborted)throw Object.assign(new Error('Export aborted'),{code:'EXPORT_ABORTED'});};
        async function array(table:string,cid?:string,transform?:(r:any)=>any) {
            await write('[');let first=true,last='';
            while(true){
                check();
                const where=[...(cid?['clinicId = ?']:[]),...(last?['id > ?']:[])];
                const rows=(await db.execute({sql:`SELECT * FROM ${table}${where.length?' WHERE '+where.join(' AND '):''} ORDER BY id ASC LIMIT 1000`,args:[...(cid?[cid]:[]),...(last?[last]:[])]})).rows;
                for(const row of rows){check();await write((first?'':',')+JSON.stringify(transform?transform(unpack(row)):unpack(row)));first=false;}
                if(rows.length<1000)break;last=rows[rows.length-1].id;
            }
            await write(']');
        }
        const clinics=await read('clinics');
        const adminRows=(await read('superadmin_credentials')).filter((row:any)=>row.id==='main');
        const credentials=[];
        for(const row of adminRows.length?adminRows:defaultAdmin?[{id:'main',...defaultAdmin}]:[]){const copy=await adminCredentialCopy(row,hashPassword);if(copy)credentials.push(copy);}
        await write('{"schemaVersion":3,"credentialSchemaVersion":'+CREDENTIAL_SCHEMA_VERSION+',"superadminCredentials":'+JSON.stringify(credentials)+',"platform":"CrownDent Multi-Tenant System Master","backupScope":"FULL_SYSTEM_BACKUP","backupTimestamp":'+JSON.stringify(new Date().toISOString())+',"totalClinicsCount":'+clinics.length+',"clinics":[');
        let first=true;
        for(const c of clinics){
            check();options.stage?.('clinic');
            await db.financeTransaction(c.id,async()=>{
                const info=await one('clinics',c.id);
                await write((first?'':',')+'{"credentialSchemaVersion":'+CREDENTIAL_SCHEMA_VERSION+',"clinicInfo":'+JSON.stringify(await clinicCredentialCopy(info,hashPassword)));
                // Flat records/teeth/xrays are authoritative. Legacy nested
                // duplicates are unnecessary, and normalize() accepts both.
                for(const table of TABLES){check();options.stage?.('table');await write(','+JSON.stringify(table)+':');await array(table,c.id);}
                await write(',"finance_state":');await finance.streamExport(c.id,write,check);
                for(const [table,alias] of Object.entries(ALIASES)){if(alias==='expenseList')continue;await write(','+JSON.stringify(alias)+':');await array(table,c.id);}
                await write('}');
            });first=false;
        }
        await write('],"renewalsLog":');await array('renewals');
        await write(',"broadcasts":');await array('announcements');
        await write(',"systemSettings":');
        const settings=(await read('system_settings')).filter((r:any)=>r.id!=='auth_secret');await write(JSON.stringify(settings)+'}');await flush();
    }
    return { handler, validateClinic: normalize, restoreClinic, streamSystemExport, streamClinicExport, exportClinic };
}
