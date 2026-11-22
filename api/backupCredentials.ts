// Recovery credentials travel only through the authenticated backup endpoint.
// Normal API responses still strip them. Keep the existing scrypt verifier format.
export const CREDENTIAL_SCHEMA_VERSION = 1;
const HASH = /^scrypt\$[0-9a-fA-F]{32}\$[0-9a-fA-F]{128}$/;
const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
const hasSecret = (value: any) => Boolean(value);

export function validateBackupHash(value: any): void {
    if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || !HASH.test(value)))
        fail('Invalid backup password hash / هاش كلمة المرور في النسخة غير صالح');
}

async function exportHash(value: any, hashPassword: (plain: string) => Promise<string>) {
    if (!hasSecret(value)) return undefined;
    // The login endpoints stringify truthy legacy fields, including numeric PINs.
    const plain = String(value);
    if (plain.startsWith('scrypt$')) { validateBackupHash(plain); return plain; }
    // Do not trim or mutate the source: the same login input must keep working.
    return hashPassword(plain);
}

export async function clinicCredentialCopy(clinic: any, hashPassword: (plain: string) => Promise<string>) {
    const out = { ...clinic };
    delete out.data; // obsolete nested copies can contain plaintext
    for (const key of ['password', 'staffPin']) {
        const hash = await exportHash(clinic[key], hashPassword);
        if (hash) out[key] = hash; else delete out[key];
    }
    if (Array.isArray(clinic.staffMembers)) out.staffMembers = await Promise.all(clinic.staffMembers.map(async (member: any) => {
        if (!member || typeof member !== 'object') return member;
        const copy = { ...member };
        delete copy.data;
        const hash = await exportHash(member.password, hashPassword);
        if (hash) copy.password = hash; else delete copy.password;
        return copy;
    }));
    validateClinicCredentials(out, CREDENTIAL_SCHEMA_VERSION);
    return out;
}

export async function adminCredentialCopy(row: any, hashPassword: (plain: string) => Promise<string>) {
    // Superadmin login historically trims the stored legacy value.
    const password = await exportHash(row.password == null ? '' : String(row.password).trim(), hashPassword);
    if (!password) return null;
    return { id: 'main', email: row.email, password, updatedAt: row.updatedAt || row.updatedat };
}

export function validateClinicCredentials(info: any, version: any): void {
    if (version === undefined) return; // old data-only files remain supported
    if (version !== CREDENTIAL_SCHEMA_VERSION) fail('Unsupported credential backup version / إصدار حسابات النسخة غير مدعوم');
    for (const key of ['password', 'staffPin']) validateBackupHash(info[key]);
    if (info.staffMembers !== undefined && !Array.isArray(info.staffMembers)) fail('Invalid staff accounts / حسابات موظفين غير صالحة');
    const ids = new Set<string>();
    for (const member of info.staffMembers || []) {
        if (!member || typeof member !== 'object' || Array.isArray(member) || typeof member.id !== 'string' || !member.id || member.id.length > 200 || ids.has(member.id))
            fail('Missing or duplicate staff account id / رقم حساب موظف مفقود أو مكرر');
        ids.add(member.id);
        validateBackupHash(member.password);
        if (member.allowedTabs !== undefined && (!Array.isArray(member.allowedTabs) || member.allowedTabs.some((tab: any) => typeof tab !== 'string')))
            fail('Invalid staff permissions / صلاحيات موظف غير صالحة');
    }
}

// Never replace an existing login identity, password, PIN or staff permissions.
// Add missing accounts, but do not delete accounts created after the backup.
export function restoreClinicCredentials(info: any, existing: any, version: any): any {
    const out = { ...info };
    delete out.data;
    if (!existing) return out;
    for (const key of ['email', 'password', 'staffPin', 'ownerId', 'isActive', 'subscriptionExpiresAt', 'subscriptionPlan', 'allowedFeatures'])
        if (existing[key] !== undefined && (key !== 'password' && key !== 'staffPin' || hasSecret(existing[key]))) out[key] = existing[key];
    if (version === CREDENTIAL_SCHEMA_VERSION) {
        const current: any[] = Array.isArray(existing.staffMembers) ? existing.staffMembers : [];
        const incoming: any[] = Array.isArray(out.staffMembers) ? out.staffMembers : [];
        const merged = current.map(member => {
            const saved = incoming.find(item => item.id === member?.id);
            return saved?.password && !hasSecret(member?.password) ? { ...member, password: saved.password } : member;
        });
        const known = new Set(current.map(member => member?.id));
        for (const member of incoming) if (!known.has(member.id)) merged.push(member);
        out.staffMembers = merged;
    } else if (Array.isArray(existing.staffMembers)) {
        // A legacy file cannot silently remove or change a current staff login.
        const members = Array.isArray(out.staffMembers) ? out.staffMembers : [];
        out.staffMembers = [...existing.staffMembers, ...members.filter((member: any) => !existing.staffMembers.some((old: any) => old?.id === member?.id))];
    }
    return out;
}

export function safeRestoredStaff(info: any) {
    if (!Array.isArray(info.staffMembers)) return info;
    const fields = new Set(['id', 'name', 'role', 'password', 'phone', 'email', 'createdAt', 'allowedTabs']);
    return { ...info, staffMembers: info.staffMembers.map((member: any) => Object.fromEntries(Object.entries(member).filter(([key]) => fields.has(key)))) };
}

export const credentialNotice = {
    en: 'Current passwords and staff access were kept. Recovered accounts use the passwords saved when the backup was made.',
    ar: 'تم الاحتفاظ بكلمات المرور وصلاحيات الموظفين الحالية. الحسابات المسترجعة تستخدم كلمات المرور المحفوظة وقت أخذ النسخة.'
};
