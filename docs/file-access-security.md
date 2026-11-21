# Per-clinic file access isolation, 21 November 2026

Found during the live-test bug-fix pass: the file-serving endpoint authenticated
the caller's login but never checked that the requested file belongs to the
caller's clinic. This document records what was exposed, what changed, and what
is intentionally left open.

## Confirmed exposure (before this change)

Verified with two isolated test clinics against a local server (`npm run test:file-access`,
5 of 10 checks failed before the fix):

- A manager or staff member of clinic B could read clinic A's uploaded files by
  requesting `GET /api/files?path=<fileName>` with their own valid token (200).
- A clinic user could upload a file into another clinic's namespace by passing a
  foreign `clinicId` to `POST /api/upload` (the presigned-URL endpoints already
  rejected this; the multipart upload endpoint did not check at all).
- Stored file names were `Date.now()` + original filename, so URLs were
  predictable in principle.

## What changed

- The `files` table carries a `clinicId` owner column. The column is added by
  the existing startup migration (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`),
  and every new upload records the owner from the authenticated token, never
  from the request body.
- `GET /api/files` resolves the file's owner and returns **404** (not 403, so a
  probing clinic cannot tell whether a file exists) when the caller belongs to
  a different clinic. The superadmin can still read every file.
- `POST /api/upload` and both `/api/get-upload-url` variants reject a requested
  `clinicId` that does not match the caller's token; when `clinicId` is omitted
  the caller's own clinic is used.
- New stored keys get a random 16-hex-character segment
  (`<timestamp>_<random>_<name>`), so Cloudflare R2 public URLs and local file
  names are unguessable in practice.

## Cloudflare R2 public URLs

In R2 mode files are served directly from the public CDN URL; `/api/files` is
not involved. Protection there is the unguessable key (`clinics/<clinicId>/<category>/<timestamp>_<random>_<name>`),
which this change adds. With 64 bits of randomness per key, enumerating other
clinics' files is not practical. Residual, accepted for now:

- Anyone who obtains a full URL (browser history, a shared link, the JSON
  backup export, server logs) can open it without authentication. If stronger
  protection is ever needed, serve R2 objects through an authenticated proxy or
  short-lived signed GET URLs instead of a public bucket. That is a larger
  change and was deliberately not bundled into this fix.

## Legacy files and fail-open behavior

- Files recorded **before** this change have no `clinicId`. They remain
  readable by any authenticated clinic user so existing patient images (demo
  and production) keep working. Narrowing them later means backfilling owners,
  e.g. by matching file paths against each clinic's xray/record documents.
- Records owned by `global` (superadmin uploads without a clinic) stay readable
  by any authenticated user.
- If the ownership lookup itself fails (e.g. an old database where the
  migration has not run yet), the endpoint logs a warning and serves the file
  rather than breaking every image in the app. This is fail-open by design and
  is the first thing to revisit if the threat model tightens.

## Tests

`tests/file-access.integration.cjs` (runner `tests/run-file-access.mjs`, script
`npm run test:file-access`) seeds two isolated clinics and legacy files, and
covers: owner manager/staff read, cross-clinic manager/staff 404, unauthenticated
401, spoofed-`clinicId` upload 403, caller-attributed upload isolation, random
key segment, and backward compatibility for legacy disk- and database-stored
files. Before the fix 5/10 checks passed; after it 10/10 pass. The finance,
offline, and live-bugs suites were re-run and pass unchanged.

## Existing PostgreSQL databases (2026-11-21)

`20261121_001_ensure_files_clinic_id` adds the ownership column separately
from the original base-schema migration. Databases that already applied the
base migration must not depend on edits to that historical migration. Fresh
installs safely skip the existing column. File reads accept both PostgreSQL's
lowercase `clinicid` result key and the local adapter's `clinicId` key.

Real-schema regression (requires local PostgreSQL server binaries):

```sh
PG_TEST_BIN=/path/to/postgresql/bin npm run test:file-migrations
```

This creates and destroys its own temporary PostgreSQL cluster. It never
connects to an existing database. It covers an already-migrated legacy schema
without the files ownership column, a fresh database, actual file upload and
byte-for-byte readback, cross-clinic manager/staff rejection, spoofed upload
rejection, legacy file preservation, and clean restart without replaying the
new migration. R2 credentials are explicitly stripped; upload coverage uses
the supported local fallback, not a real cloud bucket.

Before the migration, the legacy-schema upload returns HTTP 500 because
`clinicid` does not exist. With only the migration applied, real PostgreSQL
exposes the lowercase-result-key bug (three isolation checks fail). With both
fixes, all ten access checks pass on both legacy and fresh PostgreSQL schemas.
