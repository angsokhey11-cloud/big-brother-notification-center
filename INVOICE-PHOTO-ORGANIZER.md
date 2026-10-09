# BIG BROTHER — Invoice Photo Organizer

## Status — 09 Oct 2026
**LIVE BETA / ORIGINAL-PHOTO MODE ENABLED IN BIG BROTHER DEV.**
Private route `ANG SOKKHEY` is enabled and has two active mapped outputs: one group/topic plus the reviewer's private chat. No group pictures are read. The complete forwarding-to-delivery flow has **not yet been exercised with a real Telegram invoice-photo test**. Start with ONE non-sensitive invoice.

**Not finished:** Non-AI automatic paper-edge crop, perspective straightening, and image contrast enhancement. These should be tested separately; until then the original Telegram photo is delivered unchanged rather than risking invoice damage. Bot help texts on GitHub were updated after live webhook v36 but that text-only update may not be deployed yet. Verify the deployed versions before syncing.

## Reviewer speed and range reports — 09-Oct-2026

- **Sticky invoice date:** When the reviewer selects an invoice date, later unreviewed pictures automatically default to that date until they change it. Dates already confirmed on prior photos are never overwritten. The form still requires explicit `Save & Next` for each picture. When returning to an unfinished batch, the last confirmed date is reused.
- **Review summary by date and invoice-number ranges:** The Mini App shows total confirmed photo count per invoice date (DD-Mon-YYYY), each separate invoice number run on that date, the count of reviewed photos within that run, and the range difference `end - start`.
- **Auto split:** A consecutive numeric gap **greater than 20** starts another range, even within the same date. This separates e.g. 2220–2233 and 3300–3325 into two separate date/range entries.
- **Skip positions:** Missing serials *within* a range are expressed as offsets from its first invoice, padded to two digits (`2225` inside `2220–2233` = `05`; `3312` inside `3300–3325` = `12`). This matches the shorthand specified by the user. Counts are actual reviewed photos; duplicate invoice numbers are not falsely collapsed. Skip positions inferred only between confirmed endpoints, and should not be confused with paper-book cancellation evidence.
- **Important mathematical clarity:** `2220–2233 = 13` is a difference of 13, but 14 *inclusive* serial positions; three skipped numbers means 11 present invoices, not 10. `3300–3325 = 25` is a difference of 25, 26 inclusive; five skips means 21 present invoices, not 20. The software keeps the user's range-difference convention and reports the actual reviewer-confirmed count.
- **Private delivery confirmation:** After all mapped group/private albums succeed, `bb-invoice-photo-review` v7 sends this date/range summary privately to the reviewer (chunked for Telegram length limits) before deleting the temporary batch. No range summary is exposed in the outgoing staff group.
- Mini App static page updated. Both the private /review bot button (`bb-bank-assistant` v38) and the idle-finalizer review button (`bb-invoice-photo-finalizer` v3) use a refreshed query-string URL to bypass Telegram WebView caching.
- Verified with two date-07-Oct-2026 test ranges and a separate date retaining leading zeroes: split, arithmetic, skip offsets and sorting tests passed. Live Telegram report display is pending the next user-reviewed photo batch.

## User-approved workflow
1. Reviewer forwards selected invoice photos privately to BIG BROTHER Bot. Only messages with Telegram forward origin and a photo, from the configured authorized private reviewer chat, are accepted.
2. Bot stores temporary photo references and groups incoming forwards. New pictures do not cause any delivery to groups.
3. Reviewer sends `/done` to close the collection immediately, or waits roughly one minute for cron auto-close and a private Telegram review button. `/cancel` discards a pending collecting/review batch.
4. Reviewer opens `/review` Telegram Mini App. It shows one original picture at a time with two input boxes: date picker **Invoice Date**, text box **Invoice Number**. Both are required for every photo. The number is kept as a string so leading zeros remain.
5. `Save & Next` persists private human-confirmed metadata via signed Telegram Mini App auth; Previous, editable Summary. No chat-reply parsing and no AI auto-approval.
6. The reviewer explicitly presses **Approve & Send**. Database trigger rejects approval if any photo is unconfirmed or reviewer mismatches.
7. Server sorts by confirmed date, then numeric invoice number, then original message sequence. Sends 10 Telegram photos per album (and `sendPhoto` for a single remainder) to configured group/topic and private chat. Original source pixels are NOT edited in this beta.
8. Each destination/album has a delivery state. Successfully delivered albums are not automatically resent. Ambiguous network sends are withheld from automatic retries to avoid duplicate financial documents.
9. Once all mapped destinations succeed, server deletes entire temporary batch, Telegram photo references and review metadata, and replies with completion. Expiry cron clears abandoned data after 24h. Telegram's own message history is outside Supabase retention.

## Implemented backend
- Existing webhook `bb-bank-assistant` v36 contains private-forwarded-image intake and `/done`/`/cancel` handlers; webhook Telegram secret check and Bank Assistant group handler retained. Existing `/start`, `/myid`, `/help`, `/photo`, `/phototest`, `/review` still supported.
- Supabase Edge `bb-invoice-photo-review` v4 validates Telegram WebApp initData HMAC, reviewer admin mapping; actions load, photo preview, metadata save, approve, and retry failed albums when safe.
- Supabase Edge `bb-invoice-photo-finalizer` v1 called by `bb_invoice_photo_idle_review` cron every minute via authenticated pg_net, auto-closes idle groups and messages the reviewer privately.
- Supabase Edge `bb-invoice-photo-routing` v5 supports mapping and enable/pause admin control after checking both destinations.
- Static GitHub Pages Mini App `invoice-photo-review.html` is the one-photo/two-box form. Admin Telegram Manager page `invoice-photo-organizer.html` now shows Enable/Pause private intake.
- DB functions `bb_invoice_photo_receive`, `bb_invoice_photo_close`, `bb_invoice_photo_auto_close`. Tables: `bb_invoice_photo_routes`, `bb_invoice_photo_destinations`, `bb_invoice_photo_review_batches`, `bb_invoice_photo_queue`, `bb_invoice_photo_delivery_albums`. RLS on, direct client access revoked; service role mediates data access.
- 15-minute automatic expiry cron for temporary batch/queue and one-minute authenticated auto-finalizer cron.

## Tests completed (not equivalent to live end-to-end testing)
- Database simulated receive, duplicate suppression, batch creation, `/done`, blocked unconfirmed approval, confirmed review update, and approved batch; all inside an SQL rollback.
- DB private-only route constraint; group/topic input rejected.
- Private and group Telegram delivery mapping previously confirmed by harmless `/phototest`.
- Cron job completed and pg_net reported HTTP 200 to finalizer while no batches were pending.
- Edge Functions active and GitHub source deployed for core worker versions (review v4, routing v5, webhook v36, finalizer v1).

## Next test
From the authorized private Telegram account: forward ONE non-sensitive paper-invoice photo, then send `/done`. Tap `Open Invoice Review`, fill date and number, save, review summary, approve. Verify one original photo appears in group and private, and temporary data is deleted. If no private answer, check Supabase logs for `bb-bank-assistant`; if no picture, check `bb-invoice-photo-review` logs. If a real send is reported uncertain, do not click retry without checking Telegram history first.

After this test passes, send a 14-photo collection to check sorted 10+4 albums. Then implement and test image correction using deterministic non-AI geometry transforms without modifying original handwriting, signatures or QR codes.
