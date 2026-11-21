# Live-test bug fixes, 21 November 2026

These changes fix the defects reported during the demo walkthrough. They do not deploy the application or change an existing clinic's records or support configuration.

## Sync and conflict review

- Compare JSON values by their content, not object key order. Array order and value types still matter.
- Exclude server-managed `updatedAt`, `_fieldEdits`, and `_syncStatus` from edit preconditions. Genuine conflicting field edits still stop for review.
- Treat a value already equal to the requested value as a no-op, not a conflicting edit.
- Deduplicate identical pending optimistic edits across tabs even if the tabs saw different local base snapshots. Keep the first command's preconditions.
- Share an in-flight send for the same command so foreground writes and background sync do not race that request.
- Continue unrelated commands after a rejected earlier command. Dependent commands still wait for review.
- Use the application's non-blocking confirmation dialog for conflict and financial review. Both keep-server and apply-local choices are covered by browser tests.

Existing conflicted requests remain available for explicit review. Financial requests are not silently discarded or replayed under a new request ID. A patient with appointment, payment, or medical history still cannot be deleted.

## Geographic analytics

The table's five-row page and the full collection are loaded independently. Analytics use only the full collection, not the displayed page. Sync refreshes no longer clear the full collection after analytics have loaded. A partial offline cache is not shown as a complete clinic total.

The regression fixture contains 16 patients and three risk cases. Before the fix, a sync refresh while analytics were open changed the displayed results to five patients and zero risk cases. After the fix, the same scenario keeps 16 and three without pressing Load More.

## Images

- Retry image decoding with actual file bytes when a browser cannot decode the selected file's object URL. Invalid image bytes still fail.
- Use the encoder's actual MIME type for compressed files.
- Fetch private local `/api/files` images with authorization headers before rendering the bytes. Session tokens are not added to image URLs or sent to external image hosts.
- Keep the canonical stored file URL separate from display bytes.
- Do not cache private file responses in public HTTP caches or the service worker. The service-worker cache version is advanced to clear its older cache.

Real PNG and JPEG bytes were compressed, uploaded through the local server storage path, linked to X-ray records, read back, and rendered after reopening the patient file. Tests also cover normal decoding with an installed service worker, a deliberately unavailable object URL, and corrupt image bytes. Normal PNG/JPEG decoding already passed in the original local build, so the walkthrough's exact pre-upload failure is not claimed as independently reproduced. Cloud storage delivery still needs a check after the owner deploys.

## Refund rewards

Receipts record the points earned at collection and the points reversed by a refund. Partial refunds reverse a cumulative proportional share, using integer rounding without losing the final remainder. Full refunds reverse the full original award. Retried request IDs do not reverse points twice. For older receipts, the original award can be recovered from the saved collection request result, not today's settings.

If awarded points were already spent, a refund may leave a negative points balance. This is points debt, not money owed, and prevents collecting and refunding payments from creating free rewards. The wallet cannot redeem more points than its available balance.

Examples covered: payment 200 earns 40 points; refund 75 leaves 25 points; refund the remaining 125 leaves zero. Spending 20 points before the full refund leaves -20 points.

## Super-admin support configuration

No personal phone number or Telegram account is hardcoded. Defaults contain no sample support contacts. Empty and relative social URLs are not rendered as links back into the clinic. Telegram handles can be entered as `@handle` or an absolute HTTPS link. Email contacts retain mailto support. Invalid protocols are rejected when saving.

Support reads bypass stale query/document caches. Saving global settings waits for the server response; a manager's rejected attempt no longer produces a local success message. The owner should enter the correct contacts in the super-admin panel. Existing saved placeholder numbers are not silently changed by deployment.

## Validation

Run against a temporary isolated local database:

```sh
npm run lint
npm run test:live-bugs
npm run test:offline
npm run test:finance:ui
```

The new live-bug suite passes 12/12 checks. Against the original `a7d7718` build it passed 2/12. The pre-existing finance, offline, and Arabic/English desktop/mobile finance UI suites also pass. Tests use temporary fixture data and delete their database when finished. Upload tests use local server storage, not real cloud storage or patient images.

No live deployment, production database change, real payment, backup restoration, or physical printing was performed as part of this patch.
