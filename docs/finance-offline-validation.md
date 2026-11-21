# Finance and offline command changes

## Validation

- `npm test`: real TypeScript and isolated finance integration checks, replacing the former placeholder success message.
- `npm run test:offline`: build, finance checks, and Chromium-backed offline integration tests.
- `npm run test:finance:ui`: build, finance checks, and actual AR/EN interface controls for returns, filters, refund entry, responsive layouts, and immutable shift printing.
- Chromium is required for browser tests. Set `CHROME_PATH` when it is not `/usr/bin/google-chrome`.
- Tests use a disposable database directory and an allocated local port. They do not connect to a configured production database and remove the isolated fixture afterward.

The finance integration suite was also run against a disposable PostgreSQL database with two app server processes sharing it. Collection, idempotency and single-open-shift checks passed without local fallback.

## Boundaries

- No deployment or production financial data migration is part of these changes.
- Legacy financial records are not merged, zeroed, assigned to shifts or refunded automatically. Ambiguous shift ownership requires a manager's explicit assignment and reason.
- Patient records with appointments, financial transactions or clinical history cannot be deleted. Empty patient records can be deleted with an audit event.
- Unconfirmed money stays separate from drawer totals. Financial requests must be reviewed before closing the related shift.
- Normal clinical records and non-secret clinic settings use persisted commands. Login, credential, staff-permission and subscription changes require a live server. Browser caches strip clinic passwords and PINs.
- Pending commands belong to the signed-in account. Managers can review requests for their clinic, but cannot silently replay a staff member's request under a manager identity.
- Same-field conflicts show the patient/entity, translated field name, server and local values, and recorded editor/time. Old edits without recorded provenance are marked as not recorded.
- Explicit non-financial conflict choices preserve the original command in the local archive. Financial review never forces a stale balance. A server-side void marker prevents an archived unconfirmed request from executing later.
- Recovery downloads include command history and available attachment bytes. This is a manual recovery archive, not an automatic restore or a promise against device loss.
- Older pre-command financial queue items and files without a recorded account remain preserved for manual review rather than being silently posted.
- Offline attachment tests verify persisted bytes, retention after upload failure, and record linking using a controlled upload response. They do not prove connectivity to the live cloud storage service.
- Offline collection time is device-reported and stored separately from server confirmation time. Original operational shift dates remain separate from Cairo collection dates.
- The automated suites cover the listed flows, not every pre-existing button across the entire application.
