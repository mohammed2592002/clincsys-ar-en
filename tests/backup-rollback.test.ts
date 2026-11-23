import assert from 'node:assert/strict';
import { createBackupService } from '../api/backup';
const cid = 'rollback_fixture';
let records: any = { clinics: { [cid]: { id: cid, data: JSON.stringify({ id: cid, name: 'Original clinic', paymentMethods: [] }) } }, patients: {}, finance_state: { [cid]: { id: cid, data: JSON.stringify({ version: 1, receipts: [], events: [], requests: {} }) } } };
const before = structuredClone(records);
let mutated = false, rolledBack = false;
const db = {
    async execute(input: any) {
        const { sql, args = [] } = typeof input === 'string' ? { sql: input, args: [] } : input;
        const table = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i)?.[1];
        if (/^SELECT/.test(sql)) {
            const rows = Object.values(records[table] || {});
            return { rows: sql.includes('WHERE id = ?') ? rows.filter((r: any) => r.id === args[0]) : rows };
        }
        if (/^INSERT/.test(sql)) {
            const cols = sql.match(/\(([^)]+)\)/)[1].split(',').map((s: string) => s.trim());
            const row = Object.fromEntries(cols.map((key: string, i: number) => [key, args[i]]));
            if (table === 'patients' && row.id === 'fault')
                throw Error('Injected database failure after earlier writes');
            records[table] ||= {};
            records[table][row.id] = row;
            mutated = true;
            return { rows: [] };
        }
        if (/^UPDATE/.test(sql)) {
            const keys = sql.match(/SET (.+) WHERE/)[1].split(',').map((p: string) => p.split('=')[0].trim());
            const row = records[table][args.at(-1)];
            keys.forEach((key: string, i: number) => row[key] = args[i]);
            mutated = true;
            return { rows: [] };
        }
        throw Error('Unexpected SQL in fixture');
    },
    async financeTransaction(_id: string, fn: any) { const snapshot = structuredClone(records); try {
        return await fn();
    }
    catch (e) {
        records = snapshot;
        rolledBack = true;
        throw e;
    } }
};
const service = createBackupService({ db, getAuth: async () => ({ type: 'manager', clinicId: cid }), finance: { exportState: async () => JSON.parse(records.finance_state[cid].data), importState:async (_cid:string,state:any)=>{records.finance_state[_cid]={id:_cid,data:JSON.stringify(state)};}, ensureSchema: async () => { }, validateClinicPaymentMethods: async () => { } }, sanitizeClinic: (x: any) => x, secureClinic: async (x: any) => x, mapColumns: (_table: string, id: string, data: any, clinicId: string) => ({ cols: ['id', 'clinicId', 'data'], vals: [id, clinicId, JSON.stringify(data)] }), broadcast: () => { throw Error('Failed restore must never broadcast success'); } });
let status = 200, result: any;
const response: any = { status(value: number) { status = value; return response; }, json(value: any) { result = value; return response; } };
await service.handler({ body: { action: 'restore_clinic', clinicId: cid, backup: { clinicInfo: { name: 'Must roll back' }, data: { patients: [{ id: 'written_first', name: 'Temporary' }, { id: 'fault', name: 'Failure' }], appointments: [], finance_state: { version: 1, receipts: [], events: [], requests: {} } } } } }, response);
assert.equal(status, 500);
assert.match(result.message, /Injected database failure/);
assert(mutated);
assert(rolledBack);
assert.deepEqual(records, before);
console.log('PASS backup restore uses one clinic transaction: injected failure after profile + first patient write rolls every change back, including finance state; no success broadcast');
