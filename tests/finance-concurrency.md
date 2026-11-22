# Finance transaction concurrency

Run `npm run test:finance:concurrency` with `TEST_PG_BIN` set to the directory containing `initdb`, `pg_ctl`, and `postgres`. When using an extracted PostgreSQL package, set `TEST_PG_SHARE` to its matching share directory if required.

The test starts a disposable PostgreSQL instance bound to 127.0.0.1 on an ephemeral port. It overwrites database environment variables with that local address and never uses an existing database. It must run as a non-root user. No demo, production, or deployed VPS is contacted.

Coverage:
- The actual production PostgresDbClient class is bundled temporarily with a test-only export, not changed or exposed by the shipped server.
- One clinic's payment is paused after acquiring its lock; another clinic's payment must complete in the same client before the first is released.
- Parallel payments in one clinic preserve both receipts and the balance.
- Two independent database clients with the same idempotency key create one receipt; changing its payload returns conflict.
- Independent requests in one clinic from two clients preserve both writes.
- An injected failure after the appointment update rolls back the transaction. Retrying the same key safely commits once.
- Nested transaction calls reuse their transaction connection.
- Exact final paid/remaining amounts, receipt totals, receipt IDs, request IDs and idempotency record counts are checked.

The local JSON emulator retains its global transaction queue: it snapshots a shared file and cannot safely run concurrent independent snapshot transactions. This queue is no longer used for PostgreSQL. Database pool capacity and PostgreSQL locks still impose normal bounded-resource waits. This change is not a capacity benchmark or a migration of finance_state.
