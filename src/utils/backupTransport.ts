import { authHeaders, clearQueryCache, clearTableCache, getPendingCommands } from '../dbClient';
import { getLocalDocsForPath, removeLocalDoc } from './offlineDb';
export async function backupRequest(body: any): Promise<any> {
    if (!navigator.onLine)
        throw new Error('Backup/restore requires a connection / النسخ والاستعادة يحتاجان اتصالا بالسيرفر');
    const pending = (await getPendingCommands()).filter((c) => c.status === 'pending');
    if (pending.length)
        throw new Error('Sync or review pending changes before backup/restore / زامن أو راجع التغييرات المعلقة قبل النسخ أو الاستعادة');
    const response = await fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok)
        throw new Error(result.message || 'Backup failed / فشلت العملية');
    if (String(body.action).startsWith('restore_')) {
        clearQueryCache();
        for (const table of ['clinics', 'patients', 'appointments', 'records', 'teeth', 'xrays', 'prescriptions', 'custom_medications', 'custom_categories', 'shifts', 'expenses', 'inventory', 'billing', 'closings', 'laboratories', 'lab_orders', 'lab_work_types'])
            clearTableCache(table);
        for (const cached of await getLocalDocsForPath('finance-ledger'))
            if (body.action === 'restore_system' || String(cached.id).includes(':' + body.clinicId))
                await removeLocalDoc('finance-ledger', cached.id);
        window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { action: 'backup-restored' } }));
    }
    return result;
}
// Keep the existing human-readable SQL tables and add the complete lossless
// JSON payload. Import reads only this data marker, never executes uploaded SQL.
export function backupSqlPayload(payload: any): string {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let raw = '';
    for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
    let sql = '\nCREATE TABLE IF NOT EXISTS finance_state (id TEXT PRIMARY KEY, data TEXT, createdAt TEXT);\n';
    const clinics = payload.clinics || [payload];
    for (const clinic of clinics) {
        const state = (clinic.data || clinic).finance_state;
        if (state)
            sql += 'INSERT INTO finance_state (id,data,createdAt) VALUES (' + [quote(String(clinic.clinicId || clinic.clinicInfo?.id)), quote(JSON.stringify(state)), quote(String(payload.exportTimestamp || payload.backupTimestamp || new Date().toISOString()))].join(',') + ');\n';
    }
    return sql + '-- CMS_BACKUP_JSON_V3:' + btoa(raw) + '\n';
}
export function decodeBackupText(text: string): string {
    const marker = text.match(/^-- CMS_BACKUP_JSON_V3:([A-Za-z0-9+/=]+)\s*$/m);
    if (!marker)
        return text;
    return new TextDecoder().decode(Uint8Array.from(atob(marker[1]), c => c.charCodeAt(0)));
}
