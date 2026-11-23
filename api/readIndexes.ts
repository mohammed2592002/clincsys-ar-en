// These are the tables/columns used by the generic getDocs ownership filters.
// Keep the original OR predicates: JSON aliases and SQL NULL/range semantics
// are part of existing read behavior. Index each branch instead of rewriting
// ownership or dropping legacy matches.
const clinicTables = ['clinics','users','patients','appointments','records','prescriptions','custom_medications','custom_categories','inventory','billing','closings','laboratories','lab_orders','lab_work_types','renewals','shifts','expenses','xrays','teeth'];
const patientTables = ['appointments','records','prescriptions','xrays','teeth'];

export function legacyReadIndexStatements(): string[] {
  const statements: string[] = [];
  for (const [tables, field, alias] of [
    [clinicTables, 'clinicId', 'clinic_id'],
    [patientTables, 'patientId', 'patient_id'],
  ] as const) {
    for (const table of tables) {
      // All identifiers come from the fixed lists above, never request input.
      // Reuse the base migration's column-index names where already present.
      statements.push(`CREATE INDEX IF NOT EXISTS idx_${table}_${field} ON ${table} (${field})`);
      statements.push(`CREATE INDEX IF NOT EXISTS idx_read_${table}_${field.toLowerCase()}_json ON ${table} (json_extract(data, '$.${field}'))`);
      statements.push(`CREATE INDEX IF NOT EXISTS idx_read_${table}_${alias}_json ON ${table} (json_extract(data, '$.${alias}'))`);
    }
  }
  return statements;
}

export async function installLegacyReadIndexes(db: { getIsPostgres(): boolean; execute(sql: string): Promise<unknown> }): Promise<number> {
  if (!db.getIsPostgres()) return 0; // The JSON emulator has no query planner.
  const statements = legacyReadIndexStatements();
  // Startup-only, idempotent, no data writes and no changes to predicates.
  // Normal CREATE INDEX can block writes while building. Do not deploy this
  // migration during traffic without an approved maintenance window.
  for (const sql of statements) await db.execute(sql);
  return statements.length;
}
