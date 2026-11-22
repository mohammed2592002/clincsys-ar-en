# Approved reliability batch, local verification

## Changes
- 429 durable commands stay pending with their original idempotency key. Retry-After is respected. Automatic retry remains active; Sync now also recovers identifiable old rate-limit conflicts across screen ownership. Real conflicts still require review.
- Fixed-window limits: 400 requests/minute/authenticated user, 120 mutations/minute/user, 2,500 requests/minute/IP. POST reads are not writes. Limits are per running server process, not shared across replicas. Retry-After is returned.
- Raw X-Forwarded-For is never trusted. TRUSTED_PROXY_RANGES defaults empty. Do not configure it from a guessed Docker subnet. Verify the actual last proxy hop and externally supplied forwarding headers first.
- Booking searches all clinic patients on the server. Patient list opens with a five-record page and aggregate counts, no background full collection. Full analytics still loads when that tab is explicitly opened.
- Superadmin clinic deletion is one database transaction, including finance_state, teeth, xrays, file metadata, renewals and sync history. JSON-only historical clinic ownership is included. Batch and direct deletes share the implementation. Old clinic tokens cannot recreate missing clinics or orphan data. In-flight file metadata writes and sync events share the deletion lock.
- Physical R2 objects and disk image bytes are intentionally retained. This is not an R2 cleanup action. Recovery of deleted clinic history uses the uploaded backup.

## Verification
All tests use disposable local databases and synthetic clinics. No live load test or deploy.
- TypeScript and production build.
- Original finance and offline suites, including real English deletion UI and historical-money protection.
- Targeted malformed-body 429 retention, Retry-After, same-key retry and legacy conflict recovery.
- Unit boundaries for 400/120/2500, identity isolation, reset and POST read classification.
- Real HTTP 400 read and 120 write boundaries, Retry-After, separate users.
- Whole-clinic patient search, paging, aggregate counts, cross-clinic rejection.
- Arabic and English browser tests: oldest patient beyond first 100 found, selected and booked; initial list reads bounded.
- Open-screen idle, other-screen idle, hidden/resume and real second-session change checks. Three-second broadcast interval unchanged.
- Full backup suite: JSON/DB/ZIP/SQL real browser downloads, complete ledgers, fresh restore, collision/rollback guards, Settings and admin upload/restore controls.
- Actual isolated PostgreSQL deletion of every owned table, unrelated clinic retained, historical JSON-only ownership, injected mid-cascade failure rolls back all tables.

## Deployment boundary
Code may be merged without deployment. Dokploy inspection is read-only. Proxy trust is deliberately disabled until the actual safe hop/range is verified and the owner separately approves any Dokploy environment/config change. Host and container snapshots are idle observations, not a measured concurrency/capacity guarantee.

Commands:
```
npm run lint
npm run build
npm run test:api-limits
npm run test:patient-search
TEST_LANG=en npm run test:patient-search
TEST_OFFLINE=1 node tests/run-finance.mjs
TEST_OFFLINE=1 TEST_CLIENT_ENTRY=tests/rate-retry-client.ts TEST_OFFLINE_ENTRY=tests/rate-retry.integration.cjs node tests/run-finance.mjs
TEST_PG_BIN=/path/to/postgresql/bin TEST_PG_SHARE=/path/to/postgresql/share npm run test:clinic-delete:postgres
node tests/backups.integration.mjs
```
