# Finance warm-tab regression fix

Base: demo/main commit `b062653`.

## Cause

1. The view handler returned projected appointment and expense row objects including their `data` field. That field is the database JSON envelope, so parsed fields and serialized copies were both sent. The normalized store itself was not corrupt. No source archive or stored row needs rewriting to fix transport.
2. Scoped views had in-flight deduplication and offline copies, but no completed-response online memory cache. Each tab switch therefore fetched again. The current-shift tab also remounts the settlement component, causing a second read on re-entry.

## Changes

- Remove only the database `data` envelope from appointment and expense objects at the view response boundary. Keep every other field and all authoritative stored originals unchanged. No layout or financial rule changes.
- Cache completed view responses by session token, clinic, Cairo date and complete filter body. Keep up to 40 recently used results. Repeated identical tab and settlement reads reuse the completed result.
- Invalidate views on table/query invalidation, local financial command start, command confirmation, existing sync events and authentication changes. Cairo-day keys prevent next-day summary reuse.
- A generation key separates in-flight reads across invalidation. A late old response cannot fill the newer cache. Offline fallback does not become an online memory-cache hit. Clone results at the boundary so caller sorting or edits cannot mutate the stored cached result.

## Local evidence

Passed TypeScript and production build; finance integration and money/permission/idempotency checks; WASM PostgreSQL service checks including stripped transport envelope with exact original appointment retained; offline queue/conflict/retry; AR/EN full finance UI and frozen closing print.

New or expanded tests:

- `finance-scoped.ui.cjs`: AR and EN tab warm-up, then a complete repeated cycle of history, revenue, installments, expenses and current shift generates zero finance requests. Settlement also reuses its result. A four-event sync burst causes one fresh shift refresh; an inactive revenue view reloads once after invalidation, then caches again. No page errors.
- `finance-cache.integration.cjs`: an invalidated old in-flight result finishes after the fresh request and does not poison the cache; cached values cannot be changed by caller edits; clinic and session changes stay separate; explicit invalidation reloads.
- `finance-service.pglite.mjs`: a shift view omits the redundant appointment `data` envelope but retains the original parsed patient/price fields; stored source appointment and existing projection contents are unchanged.

Commands:

```sh
npm run lint
npm run build
TEST_UI=1 TEST_UI_ENTRY=tests/finance-scoped.ui.cjs node tests/run-finance.mjs
TEST_OFFLINE=1 TEST_OFFLINE_ENTRY=tests/finance-cache.integration.cjs node tests/run-finance.mjs
TEST_UI=1 node tests/run-finance.mjs
TEST_OFFLINE=1 node tests/run-finance.mjs
PGLITE_MODULE_PATH=/absolute/path/to/pglite/dist/index.js node tests/finance-service.pglite.mjs
```

## Expected effect, not a benchmark claim

Warm identical tab switches should avoid both financial view requests, including settlement on current-shift remount, until a sync, mutation, cache eviction, account change or Cairo-day change. A cold or invalidated shift response should be smaller because it no longer contains the duplicate serialized appointment/expense envelopes. The same money rows and matching appointments still return. No pagination, financial aggregation rewrite or reduced-history approximation was introduced.

No demo latency or decoded-byte reduction has been measured for this fix. Cold requests still transfer all matching shift appointments and receipts. Projection rebuild and command-history scan limits from the earlier patch remain. Measure the same coordinator dataset after a separately authorized demo deploy, reporting cold and warm paths separately. Returns and patient statements retain their scoped paths, and repeated identical reads can use this cache too.

Local only. No push and no deployment.
