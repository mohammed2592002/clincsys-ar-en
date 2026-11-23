# Finance normalized storage and scoped reads

## Deployment gate

This change is prepared locally against `164a432`. It does not authorize a deployment. Demo deployment requires the coordinator's separate go-ahead. Do not deploy production.

## Storage and migration

- Startup creates additive finance tables and indexes under the finance schema transaction lock.
- The first finance operation for each clinic takes that clinic's existing advisory transaction lock. It reads the original `finance_state` document, splits receipts, events, request records and assignments, and retains unknown root fields in `finance_meta`.
- Array order and duplicate IDs are preserved using ordinal entry keys. Assignment and request keys retain their exact spelling. Full payload JSON remains authoritative. Indexed columns are query helpers, not a rewrite of monetary values.
- Before committing migration, the code reconstructs the state and compares it with the original using deep equality. Failure aborts the whole transaction. The verified metadata includes a source hash and timestamp.
- The original `finance_state` row remains untouched as an archive. New code uses the normalized tables. There is no dual write or supported rollback to an older application binary after new writes.
- Repeating migration is idempotent. Clinics stay separate. Clinic deletion removes normalized state, projections, metadata and the original archive in the existing delete transaction.
- Backups export the current authoritative normalized state through the existing backup envelope. Restore replaces that state within the existing clinic transaction and invalidates the projections. The archived pre-migration row is not the current backup source.

For a later production rollout, first take and validate a database backup, run the same migration on a restored copy, compare row reconstruction and request history, and test restore before any separately authorized release. If migration fails, investigate and retry with the new code, rather than bypassing verification. If a release must be undone after new writes, restore a verified whole-database backup with an explicitly approved data-loss boundary or ship a forward fix. The old archive alone cannot recover post-migration writes.

## Read path

The finance screen, patient statement, returns and legacy settlement use scoped views. Requests and full events history no longer ride along with ordinary receipt reads. Date, patient, appointment and shift projection columns have clinic-prefixed indexes. Patient lookup preserves ID, then exact phone, then exact name precedence, including the legacy patient alias.

The main finance view coalesces a sync burst into one refresh, ignores superseded results and keeps invoice receipt state separate from tab state. Returns refreshes are also coalesced. Expense summary cards still use complete-clinic totals rather than only the visible date range. Closed snapshots remain immutable. Legacy closing reports without a frozen snapshot use an explicit full-history path and retain their existing warning.

## Limits and measurement

- This is not a universal latency claim. No post-deployment benchmark was made as part of this local patch.
- The first read after migration or a financial write rebuilds and verifies clinic projections. This still scans the relevant clinic history. It is not yet an incremental materialized-view pipeline.
- Money commands still load receipt/event/assignment history and compare changed rows. Only the relevant idempotency request keys are loaded, not all request result history. History growth can still affect commands.
- Shift matching still reads the clinic's appointment projection internally to preserve legacy payment/date/window rules, but only matching appointments are returned to the client. Refund candidates and exceptional old closing reports can still request broad data.
- The settlement receipt path checks the original date, so it currently filters internally rather than assuming collection date and operational date are interchangeable.
- Schema creation and indexes can take time and lock resources on a large database. Test on a restored production-sized copy before a production migration.
- Superadmin income statistics are deliberately unchanged.

## Verification

Local checks passed: TypeScript, production build, finance money/permission/idempotency integration, exact migration and finance service over WASM PostgreSQL, four-event burst handling, AR/EN desktop and phone views, refund flow, frozen closing print, payment methods, lab payment expense allocation, backup export and restore formats, restore rollback, offline conflict/retry, file access, direct upload and R2 clinic cleanup. Visual inspection found no intended layout change. The existing backup reminder still overlaps part of the header.

The WASM tests use real PostgreSQL SQL execution but do not establish native PostgreSQL process concurrency or live latency. The native two-client concurrency test was updated for normalized storage, but could not be run here because PostgreSQL server binaries were unavailable.

### Reproduce

```sh
npm run lint
npm run build
node tests/run-finance.mjs
TEST_UI=1 TEST_UI_ENTRY=tests/finance-scoped.ui.cjs node tests/run-finance.mjs
TEST_UI=1 node tests/run-finance.mjs
TEST_OFFLINE=1 node tests/run-finance.mjs
node tests/run-payment-methods.mjs
TEST_UI_ENTRY=tests/lab-payment-methods.integration.cjs node tests/run-payment-methods.mjs
node tests/backups.integration.mjs
npx tsx tests/backup-rollback.test.ts
node tests/run-file-access.mjs
node tests/run-direct-upload.mjs
node tests/run-r2-clinic-cleanup.mjs
```

Install `@electric-sql/pglite` in an external temporary directory and set `PGLITE_MODULE_PATH` to its `dist/index.js`, or make the package available through normal module resolution. No runtime dependency was added:

```sh
PGLITE_MODULE_PATH=/absolute/path/to/pglite/dist/index.js node tests/finance-store.pglite.mjs
PGLITE_MODULE_PATH=/absolute/path/to/pglite/dist/index.js node tests/finance-service.pglite.mjs
```

With isolated native PostgreSQL binaries available:

```sh
TEST_PG_BIN=/absolute/path/to/postgresql/bin node tests/finance-concurrency.mjs
```

After the demo release is authorized and deployed, repeat the coordinator's same clinic, dataset, AR/EN tab switches, re-entry, decoded payload and request counts, statement first/warm reads, refund/collect, backup/restore and closing-snapshot checks. Report cold projection rebuilds separately from warm reads. Do not compare local timings with the live baseline.
